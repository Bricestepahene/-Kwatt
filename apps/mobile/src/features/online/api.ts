/**
 * Données des parties en ligne (React Query + temps réel). Contrats : @kwatt/protocol
 * (http/rooms.ts, http/challenges.ts, http/games.ts, ws/rooms.ts).
 *
 *   useRoom(code)            GET /v1/rooms/:code, puis `room.state` en direct
 *   useRoomAction(code)      POST /v1/rooms/:code/{join,leave,ready,start}
 *   useCreateRoom()          POST /v1/rooms
 *   useChallenge(id)         GET /v1/challenges/:id ; useChallengeAction(id) : accept, counter…
 *   useStakeCap(userId, v)   GET /v1/challenges/cap
 *   useDiceProof(gameId)     GET /v1/games/:id/dice
 *   useWatch(gameId)         GET /v1/games/:id/watch ; usePredict(gameId)
 *   useLiveGames(family)     GET /v1/games/live
 */
import type {
  ChallengeView,
  CreateChallengeRequest,
  CreateRoomRequest,
  DiceProof,
  GameSummary,
  JoinRoomRequest,
  LiveGamesResponse,
  OpenRoomsResponse,
  PredictionsView,
  RoomStateMessage,
  RoomView,
  StakeCapView,
  WatchView,
} from "@kwatt/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, ws } from "../../api/client";
import { WS_RECONNECTED } from "../../api/ws";
import { normalizeRoomCode } from "../../ui/logic";

export const onlineKeys = {
  room: (code: string) => ["rooms", code] as const,
  openRooms: (game: string) => ["rooms", "open", game] as const,
  challenge: (id: string) => ["challenges", id] as const,
  challenges: ["challenges", "list"] as const,
  cap: (userId: string, variant: string) =>
    ["challenges", "cap", userId, variant] as const,
  dice: (gameId: string) => ["games", gameId, "dice"] as const,
  watch: (gameId: string) => ["games", gameId, "watch"] as const,
  summary: (gameId: string) => ["games", gameId, "summary"] as const,
  live: (family: string) => ["games", "live", family] as const,
};

/** Salon : lecture, puis vue envoyée par le serveur à chaque changement. */
export function useRoom(rawCode: string | undefined) {
  const code = normalizeRoomCode(rawCode ?? "");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: onlineKeys.room(code),
    queryFn: () => api.get<RoomView>(`/v1/rooms/${code}`),
    enabled: code.length === 6,
  });
  useEffect(() => {
    if (code.length !== 6) return;
    const subscribe = () => ws.send({ t: "room.subscribe", code });
    const offState = ws.on<RoomStateMessage>("room.state", (m) => {
      if (m.room.code === code)
        client.setQueryData(onlineKeys.room(code), m.room);
    });
    const offReconnect = ws.on(WS_RECONNECTED, subscribe);
    subscribe();
    return () => {
      offState();
      offReconnect();
      ws.send({ t: "room.unsubscribe", code });
    };
  }, [code, client]);
  return query;
}

export function useCreateRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomRequest) =>
      api.post<RoomView>("/v1/rooms", body),
    onSuccess: (room) => client.setQueryData(onlineKeys.room(room.code), room),
  });
}

type RoomAction =
  | { kind: "join"; body: JoinRoomRequest }
  | { kind: "leave" }
  | { kind: "ready"; ready: boolean }
  | { kind: "start" };

export function useRoomAction(rawCode: string | undefined) {
  const code = normalizeRoomCode(rawCode ?? "");
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: RoomAction) => {
      const path = `/v1/rooms/${code}/${a.kind}`;
      if (a.kind === "join") return api.post<RoomView>(path, a.body);
      if (a.kind === "ready")
        return api.post<RoomView>(path, { ready: a.ready });
      return api.post<RoomView>(path, {});
    },
    onSuccess: (room) => client.setQueryData(onlineKeys.room(code), room),
  });
}

export function useOpenRooms(game: "dames" | "ludo" | "all") {
  return useQuery({
    queryKey: onlineKeys.openRooms(game),
    queryFn: () =>
      api.get<OpenRoomsResponse>(
        "/v1/rooms/open",
        game === "all" ? {} : { query: { game } },
      ),
  });
}

// --- Défis ------------------------------------------------------------------

export function useChallenge(id: string | undefined) {
  return useQuery({
    queryKey: onlineKeys.challenge(id ?? ""),
    queryFn: () => api.get<ChallengeView>(`/v1/challenges/${id}`),
    enabled: Boolean(id),
  });
}

type ChallengeAction =
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "cancel" }
  | { kind: "counter"; stake: number };

export function useChallengeAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: ChallengeAction) =>
      api.post<ChallengeView>(
        `/v1/challenges/${id}/${a.kind}`,
        a.kind === "counter" ? { stake: a.stake } : {},
      ),
    onSuccess: (c) => {
      client.setQueryData(onlineKeys.challenge(id), c);
      void client.invalidateQueries({ queryKey: onlineKeys.challenges });
      void client.invalidateQueries({ queryKey: ["wallet"] });
    },
  });
}

export function useCreateChallenge() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChallengeRequest) =>
      api.post<ChallengeView>("/v1/challenges", body),
    onSuccess: (c) => client.setQueryData(onlineKeys.challenge(c.id), c),
  });
}

export function useStakeCap(userId: string | undefined, variant: string) {
  return useQuery({
    queryKey: onlineKeys.cap(userId ?? "", variant),
    queryFn: () =>
      api.get<StakeCapView>("/v1/challenges/cap", {
        query: { userId: userId ?? "", variant },
      }),
    enabled: Boolean(userId),
  });
}

// --- Parties : dé, regarder, en direct --------------------------------------

export function useDiceProof(gameId: string | undefined) {
  return useQuery({
    queryKey: onlineKeys.dice(gameId ?? ""),
    queryFn: () => api.get<DiceProof>(`/v1/games/${gameId}/dice`),
    enabled: Boolean(gameId),
  });
}

export function useGameSummary(gameId: string | undefined) {
  return useQuery({
    queryKey: onlineKeys.summary(gameId ?? ""),
    queryFn: () => api.get<GameSummary>(`/v1/games/${gameId}`),
    enabled: Boolean(gameId),
  });
}

export function useWatch(gameId: string | undefined) {
  return useQuery({
    queryKey: onlineKeys.watch(gameId ?? ""),
    queryFn: () => api.get<WatchView>(`/v1/games/${gameId}/watch`),
    enabled: Boolean(gameId),
    refetchInterval: 15_000,
  });
}

export function usePredict(gameId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (seat: number) =>
      api.post<PredictionsView>(`/v1/games/${gameId}/predictions`, { seat }),
    onSuccess: (predictions) => {
      client.setQueryData<WatchView>(onlineKeys.watch(gameId), (w) =>
        w ? { ...w, predictions } : w,
      );
      void client.invalidateQueries({ queryKey: ["wallet"] });
    },
  });
}

export function useLiveGames(family: "dames" | "ludo" | "all") {
  return useQuery({
    queryKey: onlineKeys.live(family),
    queryFn: () =>
      api.get<LiveGamesResponse>(
        "/v1/games/live",
        family === "all" ? {} : { query: { family } },
      ),
    refetchInterval: 20_000,
  });
}
