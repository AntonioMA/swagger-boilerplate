function ErrorInfo(aCode, aMessage) {
  this.code = aCode;
  this.message = aMessage;
}

ErrorInfo.prototype = {
  toString: () => JSON.stringify(this),
};

module.exports = ErrorInfo;
