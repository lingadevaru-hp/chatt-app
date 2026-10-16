#!/usr/bin/env node
// Build-time assert for production bundles.
// WHY: live mode bakes in ONLY when VITE_MODE=api is set. A plain
// `npm run build` ships a working demo-mode site — on the live URL that
// looks fine and silently answers nothing real. `npm run build:prod`
// runs this first and fails LOUDLY if the flag is missing, so the only
// way to produce dist/ for deploy is the deliberate command.
if (process.env.VITE_MODE !== "api") {
  console.error(
    "\nREFUSING to build for production: VITE_MODE is not 'api'.\n" +
    "A plain build ships DEMO mode (local answers, no backend).\n" +
    "Deploy with:  VITE_MODE=api npm run build:prod\n"
  );
  process.exit(1);
}
console.log("VITE_MODE=api confirmed — building live bundle.");
