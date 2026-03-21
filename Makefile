SHELL := /bin/sh
PNPM ?= pnpm

.PHONY: install bench-system-install install-bench-tools bench-system-plan bench-system-run test-system-bench bench-all test-all verify-all

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

bench-all:
	@failed=0; \
	for cmd in \
		"$(PNPM) bench:parser" \
		"$(PNPM) bench:dsl" \
		"$(PNPM) bench:system:plan" \
		"$(PNPM) bench:system:run" \
		"$(PNPM) bench:llm" \
		"$(PNPM) bench:llm:live" \
		"$(PNPM) bench:react-vs-dsl" \
		"$(PNPM) bench:react-vs-dsl:quick" \
		"$(PNPM) bench:react-vs-dsl:provider" \
		"$(PNPM) bench:react-vs-dsl:provider:both" \
		"$(PNPM) bench:react-vs-dsl:provider:optimized" \
		"$(PNPM) bench:ui-ps" \
		"$(PNPM) bench:ui-ps:gate"; do \
		echo ""; \
		echo "==> $$cmd"; \
		if ! sh -lc "$$cmd"; then \
			echo "FAILED: $$cmd"; \
			failed=1; \
		fi; \
	done; \
	if [ "$$failed" -ne 0 ]; then \
		echo ""; \
		echo "bench-all completed with failures."; \
		exit 1; \
	fi

test-all:
	@failed=0; \
	for cmd in \
		"$(PNPM) test:units-agent-plugin" \
		"$(PNPM) test:units-agent-service" \
		"$(PNPM) test:units-compiler" \
		"$(PNPM) test:units-tools-transform-verify" \
		"$(PNPM) test:ui-ps-bench" \
		"$(PNPM) test:ui-ps-gate-check" \
		"$(PNPM) test:units-ui-ir" \
		"$(PNPM) test:units-react-adapter" \
		"$(PNPM) test:dsl-bench" \
		"$(PNPM) test:vite-plugin-units-tools-agent" \
		"$(PNPM) test:units-dom-snapshot" \
		"$(PNPM) test:units-transform" \
		"$(PNPM) test:system-bench" \
		"$(PNPM) test:units-incremental"; do \
		echo ""; \
		echo "==> $$cmd"; \
		if ! sh -lc "$$cmd"; then \
			echo "FAILED: $$cmd"; \
			failed=1; \
		fi; \
	done; \
	if [ "$$failed" -ne 0 ]; then \
		echo ""; \
		echo "test-all completed with failures."; \
		exit 1; \
	fi

verify-all: bench-all test-all
