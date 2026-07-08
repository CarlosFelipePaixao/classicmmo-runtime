# ClassicMMO Network Protocol

Este documento define o protocolo inicial de comunicação entre o ClassicMMO Runtime e o servidor online.

O protocolo usa WebSocket e mensagens em JSON.

## Princípios

- Toda mensagem deve ter um campo `type`.
- O servidor é a autoridade principal.
- O cliente envia intenção.
- O servidor valida, atualiza estado e retransmite.
- IDs de jogadores são gerados pelo servidor.
- O runtime nunca deve confiar em dados permanentes vindos apenas do cliente.

## Mensagem: welcome

Enviada pelo servidor quando o cliente conecta.

```json
{
  "type": "welcome",
  "clientId": "uuid-do-cliente"
}