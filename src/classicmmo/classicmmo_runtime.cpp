#include "classicmmo_runtime.h"

#include <iostream>

namespace classicmmo {

namespace {
	NetworkClient g_network_client;
	bool g_initialized = false;
}

void ClassicMMORuntime::Initialize() {
	if (g_initialized) {
		return;
	}

	g_initialized = true;

	std::cout << "[ClassicMMO] Runtime initialized" << std::endl;
}

void ClassicMMORuntime::Shutdown() {
	if (!g_initialized) {
		return;
	}

	if (g_network_client.IsConnected()) {
		g_network_client.Disconnect();
	}

	g_initialized = false;

	std::cout << "[ClassicMMO] Runtime shutdown" << std::endl;
}

void ClassicMMORuntime::Update() {
	if (!g_initialized) {
		return;
	}

	g_network_client.Update();
}

bool ClassicMMORuntime::IsInitialized() {
	return g_initialized;
}

NetworkClient& ClassicMMORuntime::GetNetworkClient() {
	return g_network_client;
}

} // namespace classicmmo