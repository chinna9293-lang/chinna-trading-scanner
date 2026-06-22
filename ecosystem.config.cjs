module.exports = {
  apps: [{
    name: 'cloud-scanner',
    script: 'scanner.js',
    autorestart: true,
    env: {
      ALPACA_KEY:       'PK7T6WNU6ANNWQXMWFFFSYLKR7',
      ALPACA_SECRET:    'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6',
      ALPACA_BASE_URL:  'https://paper-api.alpaca.markets',
      NTFY_TOPIC:       'chinna-trading-alerts',
    }
  }]
};
