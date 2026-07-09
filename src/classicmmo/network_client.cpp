#include "network_client.h"

#include "network_message.h"

#include <iostream>

namespace classicmmo
{

    NetworkClient::NetworkClient() = default;

    NetworkClient::~NetworkClient()
    {
        Disconnect();
    }

    bool NetworkClient::Connect(const std::string &server_url)
    {
        if (connected)
        {
            return true;
        }

        url = server_url;
        socket = std::make_unique<ix::WebSocket>();
        socket->setUrl(url);

        socket->setOnMessageCallback([this](const ix::WebSocketMessagePtr &msg)
                                     {
		if (msg->type == ix::WebSocketMessageType::Open) {
            connected = true;
            std::cout << "[ClassicMMO] Connected to " << url << std::endl;

            return;
        }

		if (msg->type == ix::WebSocketMessageType::Close) {
			connected = false;
			std::cout << "[ClassicMMO] Connection closed" << std::endl;
			return;
		}

		if (msg->type == ix::WebSocketMessageType::Error) {
			connected = false;
			std::cout << "[ClassicMMO] WebSocket error: " << msg->errorInfo.reason << std::endl;
			return;
		}

		if (msg->type == ix::WebSocketMessageType::Message) {
			std::string type;

			if (NetworkMessage::TryGetType(msg->str, type)) {
				std::cout << "[ClassicMMO] Received " << type << ": " << msg->str << std::endl;
			} else {
				std::cout << "[ClassicMMO] Received invalid JSON: " << msg->str << std::endl;
			}
		} });

        socket->start();

        std::cout << "[ClassicMMO] Connecting to " << url << std::endl;

        return true;
    }

    void NetworkClient::Disconnect()
    {
        if (socket)
        {
            socket->stop();
            socket.reset();
        }

        if (connected)
        {
            std::cout << "[ClassicMMO] Disconnected from " << url << std::endl;
        }

        connected = false;
        url.clear();
    }

    bool NetworkClient::IsConnected() const
    {
        return connected;
    }

    void NetworkClient::SendChat(const std::string &text)
    {
        if (!socket || !connected)
        {
            return;
        }

        const auto message = NetworkMessage::MakeChatMessage(text);
        socket->sendText(message);

        std::cout << "[ClassicMMO] Send chat: " << message << std::endl;
    }

    void NetworkClient::SendPosition(
        const std::string &map_id,
        int x,
        int y,
        const std::string &direction)
    {
        if (!socket || !connected)
        {
            return;
        }

        const auto message = NetworkMessage::MakePositionMessage(
            map_id,
            x,
            y,
            direction);

        socket->sendText(message);

        std::cout << "[ClassicMMO] Send position: " << message << std::endl;
    }

    void NetworkClient::Update()
    {
        // IXWebSocket runs callbacks on its own internal thread.
        // Future: drain queued server events here and apply them to the game world.
    }

} // namespace classicmmo