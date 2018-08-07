const fs = require('fs');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const { logger } = require('../util/logger');
const { node } = require('../connection/ipfs');
const m3u8 = require('m3u8');

const {
  video_clip_length,
  alarm_if_no_video_for_x_seconds,
} = require('../config');

const { db } = require('../connection/lowdb');

const l = logger.info;
const d = logger.debug;
const e = logger.error;

class Video {
  constructor(user_name, folder, video, alarm_if_no_video_for_x_seconds) {
    this.user = user_name;
    this.outputFolder = `${folder}/${video.name}`;
    this.videoName = video.name;
    this.url = video.url;
    this.uuid = video.uuid;
    this.alarm_if_no_video_for_x_seconds = alarm_if_no_video_for_x_seconds;
    this.lastUpdate = Date.now();
    const watch = chokidar.watch(this.outputFolder, { ignored: /^\./, persistent: true });
    watch.on('add', this.newFile.bind(this));
    this.instance = this;
    this.stuckWatchInterval = setInterval(this.stuckWatch.bind(this), 1000);
    this.stalledCount = 0;
    this.ffmepgLogger = false;
    this.fileList = [];
    this.listItems = {}; // holds the latest references to the ts files and their durations
    this.init();
  }

  async init() {
    d(`[${this.videoName}] Initializing.`);
    await this.setupFolders();
    await this.cleanTmpFolder();
    await this.killFFmpeg();
    await this.setupDatabse();
    this.start_video_stream();
    this.m3u8Watcher();
    d(`[${this.videoName}] Initialized.`);
  }

  stuckWatch() {
    const diff = Date.now() - this.lastUpdate;
    if (diff / 1000 > alarm_if_no_video_for_x_seconds) {
      e(`[${this.videoName}] stream stalled - Restart in ${alarm_if_no_video_for_x_seconds - this.stalledCount}`);
      this.stalledCount += 1;
      this.ffmepgLogger = true;
      if (this.stalledCount >= 10) {
        this.streamProcess.kill();
        this.start_video_stream();
        this.stalledCount = 0;
      }
    } else {
      this.ffmepgLogger = false;
    }
  }

  killFFmpeg() {
    spawn('pkill', ['ffmpeg']);
  }

  addFile(filePath, name, cb) {
    const that = this;
    fs.readFile(filePath, (err, data) => {
      const len = data.toString().length;
      if (len === 0) {
        return setTimeout(() => {
          that.addFile(filePath, name, cb);
        }, 250);
      }
      if (err) {
        e('read file error ', err);
        return cb(err, null);
      }
      return node.files.add({
        path: `${that.uuid}/${name}.ts`,
        content: data
      }, (addError, filesAdded) => {
        // l(`[${this.videoName}] file added`);
        fs.unlinkSync(filePath);
        // l(`[${this.videoName}] file deleted ${filePath}`);
        if (addError) {
          // @TODO move to failed uploads folder
          e(`[${that.videoName}] ${addError}`);
          return cb(addError, null);
        }
        return cb(null, filesAdded);
      });
    });
  }

  async setupDatabse() {
    const camera = db.get(`cameras.${this.uuid}`).value();
    if (!camera) {
      db.set(`cameras.${this.uuid}`, {}).write();
    }
  }

  format(files) {
    return files.map((f) => {
      const split = f.path.split('/');
      const time = Number(split[split.length - 1].replace('.ts', ''));
      return {
        time,
        hash: f.hash,
        path: f.path,
      };
    }).filter(f => f.time);
  }

  async newFile(incoming) {
    this.fileList.push(incoming);
    if (this.fileList.length <= 1) return;
    const filePath = this.fileList.shift();
    try {
      // l(`[${this.videoName}] New file ${filePath}`);
      this.lastUpdate = Date.now();
      this.stalledCount = 0;
      if (filePath.indexOf('.m3u8') !== -1) return;
      const urlPath = filePath.split('/');
      this.addFile(filePath, urlPath[urlPath.length - 1].replace('.ts', ''), (err, added) => {
        const formatted = this.format(added);
        this.save_to_db(formatted);
      });
    } catch (newFileE) {
      e(`[${this.videoName}] ${newFileE}`);
    }
  }

  async save_to_db(newRecord, count = 0) {
    if (Array.isArray(newRecord)) newRecord = newRecord[0]; // eslint-disable-line
    if (!this.listItems[newRecord.time] && count < 5) return setTimeout(() => this.save_to_db(newRecord, count++), 500); // eslint-disable-line
    newRecord.length = this.listItems[newRecord.time].duration; // eslint-disable-line
    // update latest
    const camera = db.get(`cameras.${this.uuid}`).value();
    camera.latest = newRecord.time;
    if (!camera.videos) camera.videos = [];
    camera.videos.push(newRecord);
    // update db
    return db.set(`cameras.${this.uuid}`, camera).write();
  }

  async put_dag(new_data) {
    node.dag.put(new_data, { format: 'dag-cbor', hashAlg: 'sha2-256' }, (err, cid) => {
      if (err) {
        throw err;
      }
      const completeRecord = Object.assign({}, new_data, { cid: cid.toBaseEncodedString() });
      this.save_to_db(completeRecord);
    });
  }

  m3u8Watcher() {
    const that = this;
    this.m3WatchInterval = setInterval(() => {
      const parser = m3u8.createStream();
      if (!fs.existsSync(`vid/${this.videoName}/list.m3u8`)) return d('waiting for startup');
      const file = fs.createReadStream(`vid/${this.videoName}/list.m3u8`);
      file.pipe(parser);

      return parser.on('item', (item) => {
        if (item && item.properties) {
          const { uri, duration } = item.properties;
          const time = uri.split('.ts')[0];
          if (!that.listItems[time]) {
            that.listItems[time] = { uri, duration };
          }
        }
      });
    }, 500);
  }

  async setupFolders() {
    return new Promise((resolve, reject) => {
      try {
        if (!fs.existsSync(this.outputFolder)) {
          d(`[${this.videoName}] ${this.outputFolder} doesn't exist.`);
          return mkdirp(this.outputFolder, () => {
            d(`[${this.videoName}] Created ${this.outputFolder}.`);
            return resolve('created');
          });
        }
        return resolve('ok');
      } catch (setupFoldersError) {
        e(`[${this.videoName}] ${setupFoldersError}`);
        return reject(setupFoldersError);
      }
    });
  }

  start_video_stream(kill = false) {
    const that = this;
    if (kill && this.streamProcess) {
      this.streamProcess.kill();
      this.streamProcess = null;
    }

    // -i ${this.url} \
    // -preset ultrafast \
    // -c:v libx264 \
    // -g 5 -keyint_min 5 \
    // -force_key_frames expr:gte(t,n_forced*2) \
    // -map 0 \
    // -f segment \
    // -flags +global_header \
    // -segment_time ${video_clip_length} \
    // -segment_atclocktime 1 \
    // -segment_list_type m3u8 \
    // -segment_list vid/${this.videoName}/list.m3u8 -segment_format mpegts \
    // -strftime 1 \
    // ${this.outputFolder}/%s.ts

    const ffmpeg_command = `
      -i ${this.url} \
      -preset ultrafast \
      -c:v libx264 \
      -g 5 -keyint_min 5 \
      -force_key_frames expr:gte(t,n_forced*2) \
      -map 0 \
      -f segment \
      -flags +global_header \
      -segment_time ${video_clip_length} \
      -segment_atclocktime 1 \
      -segment_list_type m3u8 \
      -segment_list vid/${this.videoName}/list.m3u8 -segment_format mpegts \
      -strftime 1 \
      ${this.outputFolder}/%s.ts
    `;
    const cmd = ffmpeg_command.split(' ').map(c => c.replace('\n', '')).filter(c => c.length);
    const video_stream = spawn('ffmpeg', cmd);

    l(`[${this.videoName}] streaming!`);
    this.streamProcess = video_stream;

    video_stream.stdout.on('data', (data) => {
      if (that.ffmepgLogger) d(data.toString());
    });

    video_stream.stderr.on('data', (data) => {
      if (that.ffmepgLogger) d(data.toString());
    });

    video_stream.on('exit', (code) => {
      e(`Child exited with code ${code}`);
      // this.streamProcess.kill();
      // process.exit(1);
    });
  }

  cleanTmpFolder() {
    rimraf(`${this.outputFolder}/*`, () => {
      d(`[${this.videoName}] Cleaned ${this.outputFolder}`);
    });
  }
}

module.exports = Video;
