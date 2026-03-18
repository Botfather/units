SHELL := /bin/sh
PNPM ?= pnpm

.PHONY: install bench-system-install install-bench-tools bench-system-plan bench-system-run test-system-bench

install:
	$(PNPM) install

bench-system-install:
	@if command -v brew >/dev/null 2>&1; then \
		echo "Installing benchmark dependencies with Homebrew..."; \
		brew install sysbench fio iperf3; \
	elif command -v apt-get >/dev/null 2>&1; then \
		echo "Installing benchmark dependencies with apt-get..."; \
		sudo apt-get update; \
		sudo apt-get install -y sysbench fio iperf3; \
	else \
		echo "Unsupported package manager. Install sysbench, fio, and iperf3 manually."; \
		exit 1; \
	fi

install-bench-tools: bench-system-install

bench-system-plan:
	$(PNPM) bench:system:plan

bench-system-run:
	$(PNPM) bench:system:run

test-system-bench:
	$(PNPM) test:system-bench
