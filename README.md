# live stream ip camera to ipfs

ffmpeg -i http://admin:wrannaman@192.168.0.11/videostream.cgi \
-preset ultrafast \
-c:v libx264 \
-g 5 -keyint_min 5 \
-force_key_frames "expr:gte(t,n_forced*2)" \
-map 0 \
-f segment \
-flags +global_header \
-segment_time 2 \
-segment_atclocktime 1 \
-segment_list_type m3u8 \
-segment_list vid/demo_list.m3u8 -segment_format mpegts \
-strftime 1 \
vid/%Y-%m-%d_%H-%M-%S-vid.ts
