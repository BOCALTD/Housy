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
    let i = s.findIndex((l) => /^\s*not ok/.test(l));
    if (i < 0) i = s.findIndex((l) => /not ok|error|Error|failed/.test(l));
    const out = (i < 0 ? s.slice(-150) : s.slice(Math.max(0, i - 10), i + 150)).join("\n").slice(0, 60000);
    const failed = s.filter((l) => /^\s*not ok/.test(l)).map((l) => l.trim().slice(0, 200));
    if (failed.length > 1) console.log("::error title=" + process.argv[1] + " - all failed tests::" + failed.slice(0, 60).join("%0A").replace(/%(?![0-9A-F]{2})/g, "%25"));
    console.log("::error title=" + process.argv[1] + "::" + out.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A"));
  ' "$title"
fi
# Timings printed by the performance tests are published as a notice, so they can be read without downloading logs.
if grep -q "PERF name=" ci-output.log; then
  perf=$(grep -h "PERF name=" ci-output.log | sed 's/^[# ]*//' | head -60 | sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g')
  echo "::notice title=Performance results::${perf}"
fi
exit $status
