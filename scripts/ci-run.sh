#!/usr/bin/env bash
# Run a CI command. On failure, publish the relevant output as a GitHub annotation,
# so failures can be read through the API without downloading log archives.
set -o pipefail
title="$1"; shift
"$@" 2>&1 | tee ci-output.log
status=$?
if [ $status -ne 0 ]; then
  node -e '
    const s = require("fs").readFileSync("ci-output.log", "utf8").split("\n");
    const i = s.findIndex((l) => /not ok|error|Error|failed/.test(l));
    const out = (i < 0 ? s.slice(-150) : s.slice(Math.max(0, i - 10), i + 150)).join("\n").slice(0, 60000);
    console.log("::error title=" + process.argv[1] + "::" + out.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A"));
  ' "$title"
fi
exit $status
