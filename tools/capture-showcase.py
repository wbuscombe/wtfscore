#!/usr/bin/env python3
"""Run the pinned Phantom engine with an isolated, reproducible demo clock.

Run on the approved Linux CI host. This tool never publishes Git changes.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

CLOCK = "2026-11-15T21:50:00Z"
PREFIX = "WTFScore capture evidence: "
CLOCK_SCRIPT = """(() => {
  const NativeDate = window.Date;
  const instant = NativeDate.parse('2026-11-15T21:50:00Z');
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
})();"""


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def run(args: argparse.Namespace) -> int:
    import phantom
    from phantom.conductor.orchestrator import JobOptions, Orchestrator
    from phantom.conductor.state import StateManager
    from phantom.models import load_manifest
    from phantom.runners import register_runner
    from phantom.runners import playwright_capture
    from phantom.runners.web import WebRunner

    if phantom.__version__ != "0.4.0" or not phantom.__contract_version__.startswith("1."):
        raise RuntimeError("The showcase requires Phantom 0.4.0 and contract 1.x")
    # The pinned engine freezes time after navigation. Match it to the clock
    # installed before navigation so calendar controls and the initial slate agree.
    original = playwright_capture.DETERMINISM_SCRIPT
    if original.count("2026-01-15T10:30:00Z") != 1:
        raise RuntimeError("Phantom clock integration changed; review before capture")
    playwright_capture.DETERMINISM_SCRIPT = original.replace("2026-01-15T10:30:00Z", CLOCK)
    project = Path(args.project).resolve(strict=True)
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=False)
    observed: dict[str, dict] = {}
    errors: dict[str, list[str]] = {}

    browser_version = ""

    class ClockBrowser:
        def __init__(self, browser, runner):
            self.browser = browser
            self.runner = runner

        async def new_context(self, **kwargs):
            context = await self.browser.new_context(**kwargs)
            await context.add_init_script(CLOCK_SCRIPT)

            def track_page(page):
                def console(message):
                    if message.text.startswith(PREFIX):
                        value = json.loads(message.text[len(PREFIX):])
                        if value["id"] != self.runner.capture_id:
                            raise RuntimeError("Capture evidence identity mismatch")
                        observed[value["id"]] = value
                page.on("console", console)
                page.on("pageerror", lambda error: errors.setdefault(self.runner.capture_id, []).append(str(error)))
            context.on("page", track_page)
            return context

        async def close(self):
            await self.browser.close()

    class ShowcaseRunner(WebRunner):
        capture_id = ""

        async def _launch_browser(self):
            nonlocal browser_version
            await super()._launch_browser()
            browser_version = self._browser.version
            self._browser = ClockBrowser(self._browser, self)

        async def capture(self, ctx, definition):
            self.capture_id = definition.id
            result = await super().capture(ctx, definition)
            if result.success and (definition.id not in observed or errors.get(definition.id)):
                result.success = False
                result.error = "Missing state evidence or browser page error"
            if definition.id in observed:
                proof = ctx.raw_output_dir / (definition.id + ".state.json")
                with proof.open("x") as handle:
                    json.dump(observed[definition.id], handle, indent=2)
                result.metadata = observed[definition.id]
            return result

    register_runner("wtfscore-web", ShowcaseRunner)
    manifest = load_manifest(str(project / ".phantom.yml"))
    options = JobOptions(local_project=project, skip_publish=True, fail_on_quality_error=True, capture_id=args.capture)
    engine = Orchestrator(manifest=manifest, options=options, workspace_root=work / "workspaces", state_manager=StateManager(state_file=work / "state.json"))
    before = {str(p.relative_to(project)): sha(p) for p in sorted((project / "public").rglob("*")) if p.is_file()}
    report = await engine.run()
    after = {name: sha(project / name) for name in before}
    result = {
        "state": report.state.value, "expected": 1 if args.capture else len(manifest.captures),
        "succeeded": report.captures_succeeded, "failed": report.captures_failed,
        "quality_blocked": report.blocked_by_quality, "error": report.error,
        "duration_ms": report.duration_ms, "source_unchanged": before == after,
        "capture_errors": errors, "states": observed,
    }
    with (work / "result.json").open("x") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key not in ("states", "capture_errors")}))
    if result["state"] != "completed" or result["failed"] or result["succeeded"] != result["expected"] or result["quality_blocked"] or not result["source_unchanged"]:
        return 1
    captures = []
    for definition in manifest.captures:
        if args.capture and definition.id != args.capture:
            continue
        output = project / definition.output
        captures.append({
            "id": definition.id, "file": definition.output, "sha256": sha(output),
            "alt": definition.alt_text, "state": observed[definition.id],
        })
    commit = os.environ.get("GITHUB_SHA") or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=project, text=True).strip()
    published = {
        "schema": 1, "source_commit": commit,
        "source_files": before, "clock": CLOCK, "phantom": phantom.__version__,
        "capture_host": "GitHub Actions", "browser": "headless Chromium", "browser_version": browser_version,
        "ci_run": "https://github.com/" + os.environ.get("GITHUB_REPOSITORY", "wbuscombe/wtfscore") + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", ""),
        "captures": captures,
        "limitations": "Simulated fixture data. Viewport proxies, not physical-device or screen-reader acceptance.",
    }
    with (work / "manifest.json").open("x") as handle:
        json.dump(published, handle, indent=2)
    return 0


def unit_guard(args):
    """ExecStartPre: prove the kernel limits before any application runs."""
    unit = os.environ["WTS_GUARDED_UNIT"]
    if not unit.startswith("wtfscore-") or "/" in unit:
        raise RuntimeError("Unexpected unit identity")
    cgroup = Path("/sys/fs/cgroup") / Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1].lstrip("/")
    memory = int(os.environ["WTS_MEMORY_MAX"])
    tasks = int(os.environ["WTS_TASKS_MAX"])
    checks = {name: (cgroup / name).read_text().strip() for name in ("memory.max", "memory.swap.max", "pids.max", "cpu.max")}
    if checks["memory.max"] != str(memory) or checks["memory.swap.max"] != "0" or checks["pids.max"] != str(tasks):
        raise RuntimeError("Kernel resource limits were not applied")
    quota, period = checks["cpu.max"].split()
    if quota == "max" or int(quota) > int(period):
        raise RuntimeError("CPU limit was not applied")
    import resource
    file_limit = int(os.environ["WTS_FILE_MAX"])
    if resource.getrlimit(resource.RLIMIT_FSIZE) != (file_limit, file_limit):
        raise RuntimeError("Process file limit was not applied")
    fields = ["LimitFSIZE", "NoNewPrivileges", "PrivateNetwork", "PrivateTmp", "PrivateUsers", "ProtectSystem", "ProtectHome", "Restart", "OOMPolicy", "KillMode", "RuntimeMaxUSec"]
    result = subprocess.check_output(["systemctl", "show", unit] + ["--property=" + name for name in fields], text=True)
    applied = dict(line.split("=", 1) for line in result.splitlines() if "=" in line)
    expected = {"NoNewPrivileges": "yes", "PrivateNetwork": "yes", "PrivateTmp": "yes", "PrivateUsers": "yes", "ProtectSystem": "strict", "ProtectHome": "read-only", "Restart": "no", "OOMPolicy": "kill", "KillMode": "control-group"}
    if any(applied.get(key) != value for key, value in expected.items()) or applied.get("RuntimeMaxUSec") not in ("5min", "5min 0", "300000000"):
        raise RuntimeError("Application sandbox properties were not applied")
    if applied.get("LimitFSIZE") != str(file_limit):
        raise RuntimeError("Systemd file limit was not applied")
    proof = {"file_limit_bytes": file_limit, "unit": unit, "cgroup": str(cgroup), "kernel": checks, "properties": applied, "uid": os.getuid()}
    with (Path(args.work) / "unit-proof.json").open("x") as handle:
        json.dump(proof, handle, indent=2)
    print("Kernel limits and isolation verified before application launch", flush=True)
    return 0


def bounded(args):
    import time
    root = Path(args.work).resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root / "tmp").mkdir()
    (root / "cache").mkdir()
    project = Path(args.project).resolve(strict=True)
    output = project / "docs" / "screenshots"
    output.mkdir(parents=True, exist_ok=True)
    kind = args.bounded
    memory, tasks = (805306368, 64) if kind == "test" else (1610612736, 128)
    file_limit = 8388608 if kind == "test" else 33554432
    identity = os.environ.get("GITHUB_RUN_ID", "manual") + "-" + os.environ.get("GITHUB_RUN_ATTEMPT", "1") + "-" + str(os.getpid())
    unit = "wtfscore-" + kind + "-" + identity + ".service"
    script = project / "tools" / "capture-showcase.py"
    environment = {
        "PATH": os.environ["PATH"], "TMPDIR": str(root / "tmp"),
        "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1",
        "XDG_CACHE_HOME": str(root / "cache"), "WTS_GUARDED_UNIT": unit, "WTS_MEMORY_MAX": str(memory), "WTS_TASKS_MAX": str(tasks), "WTS_FILE_MAX": str(file_limit),
    }
    for name in ("PLAYWRIGHT_BROWSERS_PATH", "GITHUB_SHA", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        if name in os.environ:
            environment[name] = os.environ[name]
    if kind == "test":
        node = subprocess.check_output(["which", "node"], text=True).strip()
        command = [node, "--max-old-space-size=256", "--test", "--test-concurrency=1", "--test-timeout=120000"] + [str(path) for path in sorted((project / "test").glob("*.test.mjs"))]
    elif kind == "verify":
        if not args.manifest or not args.output or not args.contact_sheet:
            raise RuntimeError("Verification paths are required")
        command = [sys.executable, str(project / "tools" / "verify-showcase.py"), "--manifest", args.manifest, "--output", args.output, "--contact-sheet", args.contact_sheet]
    else:
        command = [sys.executable, str(script), "--inside-unit", "--project", str(project), "--work", str(root / "capture")]
        if args.capture:
            command += ["--capture", args.capture]
    properties = {
        "WorkingDirectory": str(project), "MemoryMax": str(memory), "MemorySwapMax": "0", "TasksMax": str(tasks),
        "CPUQuota": "100%", "Nice": "19", "RuntimeMaxSec": "300", "TimeoutStopSec": "3", "Restart": "no", "OOMPolicy": "kill", "KillMode": "control-group",
        "PrivateUsers": "yes", "PrivateNetwork": "yes", "PrivateTmp": "yes", "NoNewPrivileges": "yes", "ProtectSystem": "strict", "ProtectHome": "read-only", "LimitFSIZE": str(file_limit),
        "ReadWritePaths": str(root) + " " + str(output),
        "BindReadOnlyPaths": str(project / "public") + " " + str(project / "test"),
        "ExecStartPre": sys.executable + " " + str(script) + " --verify-unit --work " + str(root),
    }
    call = ["sudo", "systemd-run", "--unit=" + unit, "--wait", "--pipe", "--service-type=exec", "--uid=" + str(os.getuid()), "--gid=" + str(os.getgid())]
    for name, value in properties.items():
        call.append("--property=" + name + "=" + value)
    for name, value in environment.items():
        call.append("--setenv=" + name + "=" + value)
    call += ["--"] + command
    (root / "invocation.json").write_text(json.dumps({"unit": unit, "command": command, "properties": properties}, indent=2))
    started = time.monotonic()
    with (root / "stdout.log").open("xb") as log:
        process = subprocess.Popen(call, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = process.wait(timeout=315)
        except subprocess.TimeoutExpired:
            # This unit name was exclusively created by this invocation. Verify
            # its cgroup before signalling; never use process-name matching.
            detail = subprocess.check_output(["systemctl", "show", unit, "--property=Id", "--property=ControlGroup", "--property=MainPID", "--property=ExecMainStartTimestampMonotonic"], text=True)
            identity_readback = dict(line.split("=", 1) for line in detail.splitlines() if "=" in line)
            expected = "/system.slice/" + unit
            if identity_readback.get("Id") != unit or identity_readback.get("ControlGroup") != expected:
                raise RuntimeError("Unit identity lost; no signal sent")
            (root / "guard-stop-identity.json").write_text(json.dumps(identity_readback, indent=2))
            subprocess.run(["sudo", "systemctl", "kill", "--kill-who=all", "--signal=TERM", unit], check=True, timeout=10)
            try:
                code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                again = subprocess.check_output(["systemctl", "show", unit, "--property=Id", "--property=ControlGroup", "--property=MainPID", "--property=ExecMainStartTimestampMonotonic"], text=True)
                if again != detail:
                    raise RuntimeError("Unit identity changed before escalation")
                subprocess.run(["sudo", "systemctl", "kill", "--kill-who=all", "--signal=KILL", unit], check=True, timeout=10)
                code = process.wait(timeout=10)
            raise RuntimeError("Bounded job exceeded outer deadline")
    proof_path = root / "unit-proof.json"
    if not proof_path.exists():
        print((root / "stdout.log").read_text(errors="replace")[-12000:])
        raise RuntimeError("Application was not armed: no verified unit proof")
    proof = json.loads(proof_path.read_text())
    cgroup = Path(proof["cgroup"])
    remaining = (cgroup / "cgroup.procs").read_text().split() if cgroup.exists() else []
    result = {"exit": code, "unit": unit, "empty_cgroup": not remaining, "remaining_pids": remaining, "seconds": round(time.monotonic() - started, 3), "output_bytes": (root / "stdout.log").stat().st_size}
    with (root / "bounded-result.json").open("x") as handle:
        json.dump(result, handle, indent=2)
    print((root / "stdout.log").read_text(errors="replace")[-60000:])
    print(json.dumps(result))
    if code or remaining or result["output_bytes"] > 8388608:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=".")
    parser.add_argument("--bounded", choices=["test", "capture", "verify"])
    parser.add_argument("--manifest")
    parser.add_argument("--output")
    parser.add_argument("--contact-sheet")
    parser.add_argument("--inside-unit", action="store_true")
    parser.add_argument("--verify-unit", action="store_true")
    parser.add_argument("--work", required=True, help="New, job-owned directory; never reuse a previous run")
    parser.add_argument("--capture", help="One named capture for the smoke stage")
    args = parser.parse_args()
    if platform.system() != "Linux":
        parser.error("Application captures run only on the approved Linux CI host")
    if args.verify_unit:
        return unit_guard(args)
    if args.bounded:
        return bounded(args)
    if not args.inside_unit or not os.environ.get("WTS_GUARDED_UNIT"):
        parser.error("Use --bounded capture so kernel guards are verified first")
    import atexit
    def record_exit_limits():
        cgroup = Path("/sys/fs/cgroup") / Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1].lstrip("/")
        values = {name: (cgroup / name).read_text().strip() for name in ("memory.events", "memory.peak") if (cgroup / name).exists()}
        with (Path(args.work).parent / "kernel-exit.json").open("x") as handle:
            json.dump(values, handle, indent=2)
    atexit.register(record_exit_limits)
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
