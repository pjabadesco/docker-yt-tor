# Build for single platform

    docker buildx build --platform=linux/amd64 --tag=docker-yt-tor:latest --load .

    docker tag docker-yt-tor:latest pjabadesco/docker-yt-tor:0.1
    docker push pjabadesco/docker-yt-tor:0.1

    docker tag pjabadesco/docker-yt-tor:0.1 pjabadesco/docker-yt-tor:latest
    docker push pjabadesco/docker-yt-tor:latest

    docker tag pjabadesco/docker-yt-tor:latest ghcr.io/pjabadesco/docker-yt-tor:latest
    docker push ghcr.io/pjabadesco/docker-yt-tor:latest

# TEST

    docker-compose run app bash
    curl --proxy socks5h://127.0.0.1:9001 https://api.ipify.org
    curl --proxy socks5h://192.168.100.171:9001 https://api.ipify.org
    docker-compose up --build
    docker-compose build

    tor --hash-password abadesco

    cd ./tor-image && ./tor_create.sh 10 && cd ..
    node script.js

# RUN

    create multiple tor instances:
    https://github.com/pjabadesco/docker-tor

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
    pjabadesco/docker-yt-tor bash

    TOR_HOST=192.168.100.171 TOR_CONTROL_PASSWORD=abadesco node script.js

    docker build -t docker-yt-tor .
    