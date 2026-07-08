#ifndef CLASSICMMO_NETWORK_CLIENT_H
#define CLASSICMMO_NETWORK_CLIENT_H

#include <ixwebsocket/IXWebSocket.h>

#include <memory>
#include <string>

namespace classicmmo {

class NetworkClient {
public:
	NetworkClient();
	~NetworkClient();

	bool Connect(const std::string& server_url);
	void Disconnect();

	bool IsConnected() const;

	void SendChat(const std::string& text);

	void SendPosition(
		const std::string& map_id,
		int x,
		int y,
		const std::string& direction
	);

	void Update();

private:
	std::unique_ptr<ix::WebSocket> socket;
	bool connected = false;
	std::string url;
};

} // namespace classicmmo

#endif