// Regole di prenotazione slot con capienza, per la modalita' DEMO.
// Replicano tabelle slots/bookings, trigger bookings_sync_slot, book_slot() e cancel_booking()
// di supabase/migrations/0001_init.sql. Con Supabase reale la garanzia anti-overbooking sta nel
// CHECK (booked_count <= capacity) del database; qui la stessa regola vale in memoria.

import { randomUUID } from 'node:crypto';
import { ChError } from '../errors';
import { localDayKey } from '../time';

export interface Slot {
  id: string;
  hotelId: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  status: 'open' | 'closed';
}

export type BookingStatus = 'confirmed' | 'cancelled' | 'attended' | 'no_show';
export interface Booking {
  id: string;
  hotelId: string;
  slotId: string;
  guestId: string | null;
  partySize: number;
  status: BookingStatus;
  createdAt: Date;
  cancelledAt?: Date;
}

export interface BookingPolicy {
  maxPerGuestDay: number;
  cancelCutoffMinutes: number;
  timezone: string;
}

const ACTIVE: BookingStatus[] = ['confirmed', 'attended'];

export class SlotBook {
  slots = new Map<string, Slot>();
  bookings: Booking[] = [];

  constructor(private readonly newId: () => string = randomUUID) {}

  /** Idempotente come generate_slots(): (facility, starts_at) gia' presente = ignorato. Ritorna true se creato. */
  addSlot(s: Omit<Slot, 'id' | 'booked' | 'status'> & { id?: string }): boolean {
    for (const x of this.slots.values()) {
      if (x.facilityId === s.facilityId && x.startsAt.getTime() === s.startsAt.getTime()) return false;
    }
    if (s.capacity <= 0 || s.endsAt <= s.startsAt) throw new ChError('CH003', 'invalid_slot');
    const slot: Slot = { ...s, id: s.id ?? this.newId(), booked: 0, status: 'open' };
    this.slots.set(slot.id, slot);
    return true;
  }

  /** Cambia la capienza: mai sotto i posti gia' occupati (CHECK slots_no_overbooking). */
  setCapacity(slotId: string, capacity: number) {
    const s = this.slots.get(slotId);
    if (!s) throw new ChError('CH003', 'slot_unavailable');
    if (capacity <= 0 || capacity < s.booked) throw new ChError('CH002', 'capacity_below_booked');
    s.capacity = capacity;
  }

  setStatus(slotId: string, status: 'open' | 'closed') {
    const s = this.slots.get(slotId);
    if (!s) throw new ChError('CH003', 'slot_unavailable');
    s.status = status;
  }

  /** Unico punto in cui `booked` cambia (come il trigger bookings_sync_slot). */
  private apply(slot: Slot, delta: number) {
    const next = slot.booked + delta;
    if (next < 0 || next > slot.capacity) throw new ChError('CH002', 'slot_full');
    slot.booked = next;
  }

  book(hotelId: string, guestId: string, slotId: string, party: number, policy: BookingPolicy, now: Date): Booking {
    if (!Number.isInteger(party) || party < 1 || party > 10) throw new ChError('CH003', 'invalid_party_size');
    const slot = this.slots.get(slotId);
    if (!slot || slot.hotelId !== hotelId || slot.status !== 'open' || slot.startsAt <= now) {
      throw new ChError('CH003', 'slot_unavailable');
    }
    const day = localDayKey(slot.startsAt, policy.timezone);
    const sameDay = this.bookings.filter(
      (b) =>
        b.guestId === guestId &&
        ACTIVE.includes(b.status) &&
        localDayKey(this.slots.get(b.slotId)!.startsAt, policy.timezone) === day,
    ).length;
    if (sameDay >= policy.maxPerGuestDay) throw new ChError('CH005', 'daily_limit');
    if (this.bookings.some((b) => b.slotId === slotId && b.guestId === guestId && ACTIVE.includes(b.status))) {
      throw new ChError('CH005', 'already_booked');
    }
    this.apply(slot, party); // lancia CH002 slot_full: nessuna prenotazione parziale
    const booking: Booking = {
      id: this.newId(),
      hotelId,
      slotId,
      guestId,
      partySize: party,
      status: 'confirmed',
      createdAt: now,
    };
    this.bookings.push(booking);
    return booking;
  }

  canCancel(b: Booking, policy: BookingPolicy, now: Date): boolean {
    const slot = this.slots.get(b.slotId);
    if (!slot || b.status !== 'confirmed') return false;
    return slot.startsAt.getTime() - policy.cancelCutoffMinutes * 60_000 > now.getTime();
  }

  cancel(guestId: string, bookingId: string, policy: BookingPolicy, now: Date): void {
    const b = this.bookings.find((x) => x.id === bookingId && x.guestId === guestId);
    if (!b || b.status !== 'confirmed') throw new ChError('CH003', 'invalid_booking');
    if (!this.canCancel(b, policy, now)) throw new ChError('CH006', 'too_late');
    this.release(b, now);
  }

  private release(b: Booking, now: Date) {
    this.apply(this.slots.get(b.slotId)!, -b.partySize);
    b.status = 'cancelled';
    b.cancelledAt = now;
  }

  /** Check-out/cancellazione ospite: annulla le prenotazioni future (la capienza torna libera) e rende anonime le altre. */
  purgeGuest(guestId: string, now: Date) {
    for (const b of this.bookings) {
      if (b.guestId !== guestId) continue;
      const slot = this.slots.get(b.slotId)!;
      if (b.status === 'confirmed' && slot.startsAt > now) this.release(b, now);
      b.guestId = null;
    }
  }

  seatsBooked(slotId: string): number {
    return this.slots.get(slotId)?.booked ?? 0;
  }
}
