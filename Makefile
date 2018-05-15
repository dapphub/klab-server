
deps: evms vsc

evms:
	git submodule update --init -- evm-semantics
	cd evm-semantics && $(MAKE) deps && $(MAKE) build-java

vsc:
	git submodule update --init -- verified-smart-contracts

