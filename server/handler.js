module.exports = (msg, cb) => {
  switch(msg.type) {
    case "run":
      console.log("run");
      break;
    default:
      console.log("dunno");
  }
}
