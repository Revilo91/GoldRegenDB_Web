---
paths:
  - "Dockerfile*"
  - "docker-compose*.yml"
  - "deploy/**"
  - "proxy/**"
  - "scripts/*release*"
  - ".github/workflows/release.yml"
---

# Docker und Deployment

- Feste Image-Tags statt `latest`. Secrets über `.env`/Secrets, nicht ins Image.
- Volumes für Daten, Healthchecks für Dienste. Änderungen an Produktiv-Containern (Synology) erst nach OK.
- Release, Installation, Update und Rollback auf der Synology: Skill `deploy` (`.claude/skills/deploy/SKILL.md`), Doku in `deploy/README.md`.
