const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

export const setLogLevel = (level) => {
  threshold = LEVELS[level] ?? threshold;
};

const write = (level, msg, fields) => {
  if (LEVELS[level] < threshold) return;
  const { err, ...rest } = fields ?? {};
  const line = { time: new Date().toISOString(), level, msg, ...rest };
  if (err) line.err = { name: err.name, message: err.message, code: err.code, stack: err.stack };
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(JSON.stringify(line) + "\n");
};

export const logger = {
  debug: (msg, f) => write("debug", msg, f),
  info: (msg, f) => write("info", msg, f),
  warn: (msg, f) => write("warn", msg, f),
  error: (msg, f) => write("error", msg, f),
};
