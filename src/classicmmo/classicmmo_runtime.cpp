#include "classicmmo_runtime.h"

#include <ixwebsocket/IXNetSystem.h>

#include <cstdlib>
#include <iostream>

namespace classicmmo {
namespace {

NetworkClient g_network_client;
bool g_initialized = false;

} // namespace

void ClassicMMORuntime::Initialize() {
	if (g_initialized) {
		return;
	}

	g_initialized = true;

    ix::initNetSystem();

	std::cout << "[ClassicMMO] Runtime initialized" << std::endl;

	const char* server_url = std::getenv("CLASSICMMO_SERVER_URL");

	if (server_url && server_url[0] != '\0') {
		g_network_client.Connect(server_url);
	} else {
		std::cout << "[ClassicMMO] Network disabled. Set CLASSICMMO_SERVER_URL to connect." << std::endl;
	}
}

void ClassicMMORuntime::Shutdown() {
	if (!g_initialized) {
		return;
	}

	g_network_client.Disconnect();

    ix::uninitNetSystem();

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