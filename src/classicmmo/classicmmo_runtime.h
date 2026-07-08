#ifndef CLASSICMMO_RUNTIME_H
#define CLASSICMMO_RUNTIME_H

#include "network_client.h"

namespace classicmmo {

class ClassicMMORuntime {
public:
	static void Initialize();
	static void Shutdown();
	static void Update();

	static bool IsInitialized();

	static NetworkClient& GetNetworkClient();
};

} // namespace classicmmo

#endif