# ClassicMMO Online Architecture

Este documento define a arquitetura inicial da camada online do ClassicMMO Runtime.

## Princípio principal

O RPG Maker 2003 continua sendo usado como editor de mapas, eventos, database, personagens, itens e batalhas base.

O ClassicMMO Runtime será responsável por executar o jogo e adicionar funcionalidades online por cima do comportamento original.

## Separação de responsabilidades

### Runtime

O runtime cuida de:

- carregar projetos RPG Maker 2000/2003;
- renderizar mapas;
- executar eventos locais;
- controlar input do jogador;
- mostrar interface;
- exibir jogadores remotos;
- enviar comandos do jogador ao servidor;
- receber atualizações do servidor.

### Servidor

O servidor cuida de:

- login;
- personagens online;
- posição real dos jogadores;
- mapa atual de cada jogador;
- chat;
- presença;
- validação de movimento;
- inventário online futuro;
- combate online futuro;
- persistência de dados.

## Primeira meta online

A primeira meta online não será um MMO completo.

A primeira meta será:

1. abrir dois clientes;
2. conectar ambos ao mesmo servidor;
3. mostrar o jogador A na tela do jogador B;
4. mostrar o jogador B na tela do jogador A;
5. sincronizar movimento básico;
6. enviar mensagem de chat local.

## Componentes planejados no runtime

- ClassicMMOConfig
- NetworkClient
- AuthClient
- RemotePlayer
- RemotePlayerManager
- ChatClient
- OnlineSceneBridge

## Componentes planejados no servidor

- WebSocketServer
- PlayerSession
- MapRoom
- ChatService
- CharacterRepository
- PositionSyncService

## Regra de segurança

Tudo que afeta progressão permanente deve ser validado pelo servidor.

O cliente pode pedir uma ação, mas o servidor decide se ela é válida.