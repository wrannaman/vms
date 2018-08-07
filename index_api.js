/* ====================== API  ====================== */
const feathers = require('@feathersjs/feathers')
const socketio = require('@feathersjs/socketio');
const express = require('@feathersjs/express');
const cors = require('cors')
const uws = require('uws');
const m3u8 = require('m3u8');
const fs = require('fs');
const { node } = require('./connection/ipfs');

const {
  video_clip_length,
} = require('./config');

const app = feathers();
const expressApp = express(feathers());
// Turn on JSON parser for REST services
expressApp.use(express.json());
// Turn on URL-encoded parser for REST services
expressApp.use(express.urlencoded({ extended: true }));
expressApp.use(cors());
// Set up REST transport
expressApp.configure(express.rest());


const { db } = require('./connection/lowdb');
const { videos } = require('./config');
console.log('VIDEOS', videos)

// // Register a service
// expressApp.use('/livestream', {
//   get(id) {
//     console.log('\n\n');
//     console.log('get id ', id);
//     const cameraConfig = videos.filter(v => v.name === id);
//     console.log('cameraConfig', cameraConfig)
//     const camera = db.get(`cameras.${cameraConfig[0].uuid}`).value();
//     // console.log('CAMERA', camera)
//     const m3u = m3u8.M3U.create();
//     m3u.addPlaylistItem({
//       duration: 1,
//       uri: `http://localhost:3031/latest-ts/${id}`
//     });
//     m3u.set('playlistType', 'VOD')
//     console.log('M3U', m3u)
//     // look up the cmaera
//     //
//     return Promise.resolve(Buffer.from(m3u.toString()).toString('base64'));
//   }
// });

// // Register a service
// expressApp.use('/latest-ts', {
//   get(id) {
//     console.log('\n\n');
//     console.log('latest ts!!!! ', id);
//     // look up the cmaera
//     return Promise.resolve({ ok: true });
//   }
// });

// Register an Express middleware
expressApp.use('/latest_ts/:id', (req, res) => {
  let { id } = req.params;
  id = id.replace('.ts', '');
  const cameraConfig = videos.filter(v => v.name === id);
  const latestTimestamp = db.get(`cameras.${cameraConfig[0].uuid}.latest`).value();
  const storageInfo = db.get(`cameras.${cameraConfig[0].uuid}.videos`).find({ time: latestTimestamp }).value();

  node.files.cat(storageInfo.hash, (err, files) => {
    if (err) return res.send(err);
    res.header('Content-Type', 'application/vnd.apple.mpegurl'); // application/x-mpegURL
    // res.header('Content-Length', str.length);
    res.header('Cache-Control', 'no-cache');
    return res.send(files);
  });
});

expressApp.use('/livestream.m3u8', (req, res) => {
  const { name } = req.query;
  const m3u = m3u8.M3U.create();
  m3u.addPlaylistItem({
    duration: video_clip_length,
    uri: `latest_ts/${name}.ts`
  });
  //   const str = `#EXTM3U
  // #EXT-X-VERSION:3
  // #EXT-X-PLAYLIST-TYPE:VOD
  // #EXT-X-TARGETDURATION:${video_clip_length + 1}
  // #EXTINF:${video_clip_length}.000,
  // latest_ts/${name}.ts
  // #EXT-X-ENDLIST`;

  m3u.set('playlistType', 'VOD');
  m3u.set('targetDuration', video_clip_length + 1);
  res.header('Content-Type', 'application/vnd.apple.mpegurl'); // application/x-mpegURL
  res.header('Content-Length', m3u.toString().length);
  res.header('Cache-Control', 'no-cache');
  return res.end(m3u.toString(), 'utf-8');
});

expressApp.use('/livestream/latest_ts/:id', (req, res) => {
  console.log('\n\n is this bei=ng called \n\n');
})

// // Register multiple Express middleware functions
// expressApp.use('/livestream', (req, res, next) => {
//   res.data = 'Step livestream worked';
//   next();
// }, (req, res) => {
//   res.json({
//     message: `Hello world from Express middleware ${res.data}`
//   });
// });


const api = expressApp.listen(3031)
api.on('listening', () => console.log('API application started on 3031'));


app.configure(socketio({
  wsEngine: 'uws'
}));
app.listen(3030);

// app.configure(socketio(function(io) {
//   io.use(function (socket, next) {
//     socket.feathers.user = { name: 'David' };
//     next();
//   });
// }));


// Register a simple todo service that returns the name and some text
app.use('livestream', {
  async get(name) {
    console.log('WS: getting livestream');
    // Return an object in the form of { name, text }
    return {
      name,
      text: `You have to do ${name}`
    };
  }
});

// // A function that gets and logs a todo from the service
// async function testLivestream(name) {
//   // Get the service we registered above
//   const service = app.service('livestream');
//   // Call the `get` method with a name
//   const todo = await service.get(name);
//
//   // Log the todo we got back
//   console.log(todo);
// }
//
// testLivestream('dishes');
