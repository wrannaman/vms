const Video = require('../model/Video');
const {
  user_name,
  folder,
  videos,
  alarm_if_no_video_for_x_seconds,
} = require('../config');
const { logger } = require('../util/logger');

const l = logger.info;
module.exports.initialize = () => {
  l('initializing', user_name);
  l('videos ', videos);
  const instances = [];
  videos.forEach((vid, i) => {
    setTimeout(() => {
      const v = new Video(user_name, folder, vid, alarm_if_no_video_for_x_seconds);
      instances.push(v);
    }, 200 * i);
  });
};
