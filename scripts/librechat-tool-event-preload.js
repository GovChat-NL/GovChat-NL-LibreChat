// Loaded with Node's --require before LibreChat starts. The runtime overlay
// hooks the stock image's CommonJS loader without modifying its source files.
require('./librechat-tool-event-overlay').installOverlayLoader();
