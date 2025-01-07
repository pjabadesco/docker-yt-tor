# Start with your base image
FROM node:20-bullseye

# Install necessary dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxrandr2 \
    libxi6 \
    libxdamage1 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libcups2 \
    fonts-liberation \
    # libjpeg-turbo8 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    libxcb1 \
    libxfixes3 \
    libxinerama1 \
    libxkbcommon0 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libdbus-1-3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Set working directory
WORKDIR /usr/src/app

# Copy project files
COPY . .

# Start the application
CMD ["node", "script.js"]