# Deploy the static captive-portal to production.
#
# The site is plain HTML/CSS/JS — there is no build step. nginx on the target
# serves it directly from $(REMOTE_DIR) (alias in web.ratzek.conf). We simply
# rsync the working tree there. This is independent of the prod git checkout,
# which has drifted (older commit + manual edits), so `git pull` on prod is
# unreliable — rsync overwrites the served files deterministically.
#
# Usage:
#   make dry-run          # preview changes, touches nothing
#   make deploy           # ship the working tree to prod
#   make deploy REMOTE_HOST=root@other-host

REMOTE_HOST ?= root@10.11.5.1
REMOTE_DIR  ?= /var/www/ratzek-portal/

# Do not preserve local owner/group (source is owned by a user absent on prod);
# --checksum ignores the meaningless mtimes of git checkouts; --delete keeps prod
# a clean mirror (excluded paths like .git are protected from deletion).
RSYNC_FLAGS = -rlptvz --checksum --delete \
	--exclude='.git/' \
	--exclude='.gitignore' \
	--exclude='Makefile' \
	--exclude='README.md' \
	--exclude='dev/' \
	--exclude='.claude/' \
	--exclude='*.log'

.PHONY: all help dry-run deploy

all: help

help:
	@echo "Targets:"
	@echo "  make dry-run   Preview what would be deployed (no changes)"
	@echo "  make deploy    Deploy the working tree to $(REMOTE_HOST):$(REMOTE_DIR)"

dry-run:
	rsync $(RSYNC_FLAGS) --dry-run --itemize-changes ./ $(REMOTE_HOST):$(REMOTE_DIR)

deploy:
	rsync $(RSYNC_FLAGS) ./ $(REMOTE_HOST):$(REMOTE_DIR)
	@echo ">> deployed to $(REMOTE_HOST):$(REMOTE_DIR)"
