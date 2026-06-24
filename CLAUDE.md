<!-- site-phase-plan -->
## Upgrading this site's content phases

This site is built in phases (foundation → expansion → maturity → authority). The schedule
lives in [`_plan/PHASE_PLAN.md`](_plan/PHASE_PLAN.md).

To upgrade: read `_plan/PHASE_PLAN.md`, build the **Next phase** it names by adding pages and
applying the page blueprint to everything you touch, then record it from the Django project:
`.venv/bin/python manage.py set_site_phase geospatialwebhook.com --completed <phase>`.
