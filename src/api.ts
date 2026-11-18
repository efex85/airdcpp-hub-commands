import { APISocket } from 'airdcpp-apisocket';

import { HubMessageItem, HubSession, HubUser, SeverityEnum } from './types';


export const API = (socket: APISocket) => {
  const getHub = async (sessionId: number) => {
    return socket.get<HubSession>(`hubs/${sessionId}`);
  };

  const getHubUser = async (sessionId: number, userId: number) => {
    return socket.get<HubUser>(`hubs/${sessionId}/users/${userId}`);
  };

  // Recent hub messages, used for finding the nick of users who have left the hub
  const getHubMessages = async (sessionId: number, maxCount: number) => {
    return socket.get<HubMessageItem[]>(`hubs/${sessionId}/messages/${maxCount}`);
  };

  const sendChatMessage = async (sessionId: number, text: string, thirdPerson: boolean) => {
    return socket.post(`hubs/${sessionId}/chat_message`, {
      text,
      third_person: thirdPerson,
    });
  };

  const postEvent = async (text: string, severity: SeverityEnum) => {
    return socket.post('events', {
      text,
      severity,
    });
  };

  return {
    getHub,
    getHubUser,
    getHubMessages,
    sendChatMessage,
    postEvent,
  };
};

export type APIType = ReturnType<typeof API>;
