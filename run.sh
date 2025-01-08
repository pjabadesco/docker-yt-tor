docker buildx build --platform=linux/amd64 --tag=docker-yt-tor:latest --load .

docker run -it --rm \
    -e TOR_HOST=192.168.100.171 \
    -e TOR_CONTROL_BASE_PORT=7001 \
    -e TOR_PROXY_BASE_PORT=9001 \
    -e TOR_CONTROL_PASSWORD=abadesco \
    -e YOUTUBE_URL="https://www.youtube.com/watch?v=BPydARoYxa4" \
    -e RERUN_TIMES=10 \
    -e TOR_POOL_SIZE=10 \
    -e WATCH_TIME_SEC=50 \
    -v $(pwd)/screenshots:/usr/src/app/screenshots \
    docker-yt-tor
