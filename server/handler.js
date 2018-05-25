const _ = require("lodash");
const fs = require("fs");
const keccak = require("keccak");
const { spawn } = require('child_process');
const kill = require('tree-kill');
const testPath = path => {
  try {
    fs.accessSync(path, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

const sha3 = function (str) {
  return keccak('keccak256')
    .update(str)
    .digest('hex')
    .toString()
    .slice(0, 8);
}

const lemmas_tmp_str = fs.readFileSync(__dirname + "/verification_tmp.k").toString();
const lemmas_tmp = _.template(lemmas_tmp_str);



var kprove;
var gen_spec;


const stop = () => {
  if(kprove) {
    kill(kprove.pid);
  }
  kprove = null;
}

const run = ({spec, lemmas, bin_runtime, replay}, ch) => {
  let verification = lemmas_tmp({data: lemmas});
  let spec_file = spec + `\n\n[pgm]\ncompiler: "Solidity"\ncode: "0x${bin_runtime.trim()}"`
  let state = {
    verification,
    spec_file
  };
  let id = sha3(JSON.stringify(state))
  ch({type: "sid", data: id})
  if(replay && testPath(`../wd/${id}/steps.json`)) {
    let steps = JSON.parse(fs.readFileSync(`../wd/${id}/steps.json`));
    steps.msgs.forEach(step => ch(step));
    return null;
  }
  if(!testPath(`../wd/${id}/`)) fs.mkdirSync(`../wd/${id}/`);
  if(!testPath(`../wd/${id}/nodes/`)) fs.mkdirSync(`../wd/${id}/nodes/`);
  if(!testPath(`../wd/${id}/rules/`)) fs.mkdirSync(`../wd/${id}/rules/`);
  if(!testPath(`../wd/${id}/steps/`)) fs.mkdirSync(`../wd/${id}/steps/`);
  if(!testPath(`../wd/${id}/circc/`)) fs.mkdirSync(`../wd/${id}/circc/`);
  fs.writeFileSync(`../wd/${id}/verification.k`, verification);
  fs.writeFileSync(`../wd/${id}/spec.ini`, spec_file);
  fs.copyFileSync(`../verified-smart-contracts/bihu/abstract-semantics.k`, `../wd/${id}/abstract-semantics.k`);
  gen_spec = spawn("python3", [
    "../verified-smart-contracts/resources/gen-spec.py",
    "../verified-smart-contracts/bihu/module-tmpl.k",
    "../verified-smart-contracts/bihu/spec-tmpl.k",
    `../wd/${id}/spec.ini`,
    `loop`,
    `loop`
  ]);

  gen_spec.stderr.on("data", data => {
    console.log(data.toString())
  })
  gen_spec.stdout.on('data', (data) => {
    fs.writeFileSync(`../wd/${id}/loop-spec.k`, data);
  });
  gen_spec.on('close', (code) => {
    let msgs = [];
    kprove = spawn("../../../evm-semantics_/.build/k/k-distribution/target/release/k/bin/kprove", [
      "--directory",
      "../../evm-semantics/.build/java/",
      "--z3-executable",
      `./loop-spec.k`,
      "--def-module",
      "VERIFICATION"
    ],{
      cwd: `../wd/${id}/`
    })
    kprove.stdout.on('data', (data, a) => {
      console.log(data.toString());
      data = data.toString().trim().split(" ");
      let msg = {
        type: data[0],
        data: data.slice(1)
      };
      msgs.push(msg);
      ch(msg);
    })
    kprove.stderr.on('data', (data, a) => {
      console.log(data.toString());
      let msg = {
        type: "error",
        data: data.toString()
      };
      msgs.push(msg);
      ch(msg);
    })
    kprove.on('close', (code) => {
      fs.writeFileSync(`../wd/${id}/steps.json`, JSON.stringify({
        msgs: msgs
      }))
      console.log("kprove finished", code);
    })
    kprove.on('error', (code) => {
      console.log("error", code);
    })
  })
}

const getnode = (data, ch) => {
  let d_ = data.split(" ");
  let node = JSON.parse(fs.readFileSync(`../wd/${d_[0]}/nodes/${d_[1]}.json`).toString());
  ch({
    type: "node",
    data: {
      id: d_[1],
      node
    }
  });
}

const getFileExcerpt = (path, from, to) => fs
  .readFileSync(path)
  .toString()
  .split("\n")
  .slice(from - 1, to)
  .filter(l => l != "")
  .join("\n");

const parseRule = ruleString => {
  const pos_regex = /Location\((\d+)\,\d+\,(\d+)\,\d+\)/;
  const src_regex = /Source\(Source\(([^\)]+)\)/;
  const location = ruleString.match(pos_regex);
  const filepath = ruleString.match(src_regex)[1];
  const from = location[1];
  const to = location[2];
  // let string = fs.readFileSync(filepath).toString();
  // let string = clc.xterm(0)(`${filepath} ${from}-${to}\n     `) + getFileExcerpt(filepath, parseInt(from), parseInt(to)).split("\n").join("\n    ").trim();
  let string = getFileExcerpt(filepath, parseInt(from), parseInt(to)).trim()
  // if(string.split("\n").length > 6) {
  //   string = string.split("\n").slice(0, 3)
  //   // .concat(["  [...]"])
  //   // .concat([clc.red("  [...]")])
  //   .concat(string.split("\n").slice(-3))
  //   .join("\n")
  // }

  return {
    from,
    to,
    filepath,
    string
  };
}

const getrule = (data, ch) => {
  let d_ = data.split(" ");
  let rule = fs.readFileSync(`../wd/${d_[0]}/rules/${d_[1]}.json`).toString();
  ch({
    type: "rule",
    data: {
      id: d_[1],
      rule: parseRule(rule)
    }
  });
}

const getcircc = (data, ch) => {
  let d_ = data.split(" ");
  let circc = fs.readFileSync(`../wd/${d_[0]}/circc/${d_[1]}.json`).toString();
  ch({
    type: "circcdata",
    data: {
      id: d_[0],
      circc
    }
  });
}

module.exports = (msg, ch) => {
  switch(msg.type) {
    case "run":
      console.log("run");
      run(msg.data, ch);
      break;
    case "stop":
      console.log("stop");
      stop();
      break;
    case "getnode":
      console.log("getnode", msg.data);
      getnode(msg.data, ch);
      break;
    case "getrule":
      console.log("getrule", msg.data);
      getrule(msg.data, ch);
      break;
    case "getcircc":
      console.log("getcircc", msg.data);
      getcircc(msg.data, ch);
      break;
    default:
      console.log("dunno", msg);
  }
}
