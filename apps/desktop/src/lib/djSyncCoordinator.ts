/**
 * Mixxx EngineSync-style BPM coordinator for booth decks.
 * Leader deck sets tempo; followers adjust rate to match.
 */
import { engineClient } from "./engineClient";

export interface SyncDeckInfo {
  deckIndex: number;
  bpm: number;
  rate: number;
  loaded: boolean;
}

export class DjSyncCoordinator {
  private leaderDeck = -1;
  private leaderBpm = 128;
  private followerKey = "";
  private appliedRates = new Map<number, number>();

  setLeader(deckIndex: number, bpm: number): void {
    const nextBpm = Math.max(60, bpm);
    if (this.leaderDeck === deckIndex && this.leaderBpm === nextBpm) return;
    this.leaderDeck = deckIndex;
    this.leaderBpm = nextBpm;
    this.followerKey = "";
    void engineClient.deckSetSyncMode(deckIndex, "leader");
  }

  clear(): void {
    this.leaderDeck = -1;
    this.leaderBpm = 128;
    this.followerKey = "";
    this.appliedRates.clear();
  }

  syncFollowers(decks: SyncDeckInfo[]): void {
    if (this.leaderDeck < 0 || this.leaderBpm <= 0) return;

    const key = decks
      .filter(d => d.loaded && d.deckIndex !== this.leaderDeck)
      .map(d => `${d.deckIndex}:${d.bpm}:${d.rate}`)
      .join("|");
    if (key === this.followerKey) return;
    this.followerKey = key;

    for (const deck of decks) {
      if (!deck.loaded || deck.deckIndex === this.leaderDeck) continue;
      if (deck.bpm <= 0) continue;

      const targetRate = this.leaderBpm / deck.bpm;
      const clamped = Math.max(0.5, Math.min(2, targetRate));
      const prev = this.appliedRates.get(deck.deckIndex);
      if (prev == null || Math.abs(prev - clamped) > 0.004) {
        this.appliedRates.set(deck.deckIndex, clamped);
        void engineClient.deckSetRate(deck.deckIndex, clamped);
      }
      void engineClient.deckSetSyncMode(deck.deckIndex, "follower");
    }
  }
}

export const djSyncCoordinator = new DjSyncCoordinator();
