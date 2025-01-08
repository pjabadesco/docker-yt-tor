FROM ubuntu:20.04

# Set environment variable to avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
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
    ttf-mscorefonts-installer \
    libxfixes3 \
    libxkbcommon0 \
    libpango1.0-0 \
    libcairo2 \
    unzip \
    tor \
    telnet \
    iputils-ping \
    net-tools \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Chrome for Testing
RUN mkdir -p /opt/google/chrome/ && \
    wget https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.264/linux64/chrome-linux64.zip && \
    unzip chrome-linux64.zip -d /opt/google/chrome/ && \
    rm chrome-linux64.zip && \
    chmod +x /opt/google/chrome/chrome-linux64/chrome && \
    ln -s /opt/google/chrome/chrome-linux64/chrome /usr/bin/google-chrome

# Verify Chrome installation
RUN google-chrome --version

# Install Node.js and npm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use Chrome for Testing
ENV PUPPETEER_EXECUTABLE_PATH="/opt/google/chrome/chrome-linux64/chrome"

# Install Puppeteer and other required Node.js packages
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Expose ports for Tor
EXPOSE 9050 9051

# Start the application
CMD ["node", "script.js"]