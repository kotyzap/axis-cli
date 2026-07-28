"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.info = info;
exports.warn = warn;
exports.fail = fail;
exports.printJson = printJson;
exports.action = action;
const chalk_1 = __importDefault(require("chalk"));
function ok(msg) {
    console.log(chalk_1.default.green('✓'), msg);
}
function info(msg) {
    console.log(chalk_1.default.cyan('ℹ'), msg);
}
function warn(msg) {
    console.log(chalk_1.default.yellow('⚠'), msg);
}
function fail(msg) {
    console.error(chalk_1.default.red('✗'), msg);
}
function printJson(data) {
    console.log(JSON.stringify(data, null, 2));
}
/** Wraps an async command handler so rejected promises print a clean error instead of a raw stack trace. */
function action(fn) {
    return async (...args) => {
        try {
            await fn(...args);
        }
        catch (err) {
            fail(err.message);
            process.exitCode = 1;
        }
    };
}
