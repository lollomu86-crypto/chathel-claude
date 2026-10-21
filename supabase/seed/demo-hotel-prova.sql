-- Dati di esempio per Hotel Prova (SOLO per le demo ai direttori).
-- Da incollare nell'editor SQL di Supabase. Si puo' rilanciare quando si vuole: ricrea eventi, servizi,
-- informazioni dell'hotel e avviso di benvenuto. ATTENZIONE: cancella anche le prenotazioni fatte sui
-- servizi di Hotel Prova (non tocca ospiti, soggiorni, bonus ne' chat).
-- Le informazioni sono INVENTATE: nessun nome, orario o prezzo e' di una struttura vera.

do $seed$
declare
  h uuid;
  today date := (now() at time zone 'Europe/Rome')::date;
  f_spa uuid; f_mas uuid; f_pool uuid; f_game uuid; f_rest uuid;
begin
  select id into h from public.hotels where slug = 'hotel-prova';
  if h is null then raise exception 'Hotel Prova non trovato (slug hotel-prova)'; end if;

  -- impostazioni dell'hotel per la demo (bonus attivo, stagione che copre le prossime settimane)
  update public.hotels set
    season_start = today - 30,
    season_end = today + 150,
    bonus_enabled = true,
    bonus_label = 'Caffe'' di benvenuto',
    bonus_season_cap = 300,
    bonus_value_cents = 0
  where id = h;

  -- pulizia dei dati demo precedenti
  delete from public.events        where hotel_id = h;
  delete from public.facilities    where hotel_id = h;   -- cancella a cascata slot e prenotazioni
  delete from public.ai_knowledge  where hotel_id = h;
  delete from public.notifications where hotel_id = h and guest_id is null and kind = 'announcement';

  -- eventi (pubblicati) nei prossimi giorni, orari di Roma
  insert into public.events(hotel_id, title, description, location, starts_at, ends_at, capacity, published, image_url) values
  (h, '{"it":"Aperitivo di benvenuto","en":"Welcome aperitivo","de":"Willkommens-Aperitif"}',
      '{"it":"Un calice di benvenuto in terrazza per conoscere lo staff e scoprire il programma della settimana.","en":"A welcome drink on the terrace to meet the team and discover the week''s programme.","de":"Ein Willkommensgetränk auf der Terrasse, um das Team kennenzulernen und das Wochenprogramm zu entdecken."}',
      'Terrazza', ((today + 1) + time '19:00') at time zone 'Europe/Rome', ((today + 1) + time '20:00') at time zone 'Europe/Rome', null, true, '/demo/aperitivo-benvenuto.svg'),
  (h, '{"it":"Yoga all''alba","en":"Sunrise yoga","de":"Yoga bei Sonnenaufgang"}',
      '{"it":"Mezz''ora di yoga leggero sulla spiaggia, adatto a tutti. Porta un asciugamano.","en":"Half an hour of gentle yoga on the beach, suitable for everyone. Bring a towel.","de":"Eine halbe Stunde sanftes Yoga am Strand, für alle geeignet. Bitte ein Handtuch mitbringen."}',
      'Spiaggia', ((today + 2) + time '07:30') at time zone 'Europe/Rome', ((today + 2) + time '08:15') at time zone 'Europe/Rome', 20, true, '/demo/yoga-alba.svg'),
  (h, '{"it":"Torneo di beach volley","en":"Beach volleyball tournament","de":"Beachvolleyball-Turnier"}',
      '{"it":"Squadre miste da quattro. Iscrizione libera fino a esaurimento posti, premio per i vincitori.","en":"Mixed teams of four. Open sign-up while places last, prize for the winners.","de":"Gemischte Vierer-Teams. Anmeldung solange Plätze frei sind, Preis für die Sieger."}',
      'Campo da beach volley', ((today + 2) + time '17:00') at time zone 'Europe/Rome', ((today + 2) + time '19:00') at time zone 'Europe/Rome', 24, true, '/demo/beach-volley.svg'),
  (h, '{"it":"Musica dal vivo in piazzetta","en":"Live music in the piazzetta","de":"Live-Musik auf der Piazzetta"}',
      '{"it":"Duo acustico dopo cena, con cocktail al bar della piazzetta.","en":"Acoustic duo after dinner, with cocktails at the piazzetta bar.","de":"Akustik-Duo nach dem Abendessen, mit Cocktails an der Piazzetta-Bar."}',
      'Piazzetta', ((today + 3) + time '21:30') at time zone 'Europe/Rome', ((today + 3) + time '23:00') at time zone 'Europe/Rome', null, true, '/demo/musica-piazzetta.svg'),
  (h, '{"it":"Caccia al tesoro per famiglie","en":"Family treasure hunt","de":"Schatzsuche für Familien"}',
      '{"it":"Un percorso a indizi in tutto il resort per grandi e piccoli, con merenda finale.","en":"A clue trail around the resort for young and old, with a snack at the end.","de":"Eine Schnitzeljagd durch das ganze Resort für Groß und Klein, mit Imbiss zum Abschluss."}',
      'Ritrovo alla reception', ((today + 4) + time '10:30') at time zone 'Europe/Rome', ((today + 4) + time '12:00') at time zone 'Europe/Rome', 40, true, '/demo/caccia-al-tesoro.svg'),
  (h, '{"it":"Serata a tema: cena sarda","en":"Theme night: Sardinian dinner","de":"Themenabend: Sardisches Abendessen"}',
      '{"it":"Menu ispirato alla cucina sarda al ristorante, con un assaggio di prodotti del territorio.","en":"A menu inspired by Sardinian cuisine at the restaurant, with a taste of local products.","de":"Ein von der sardischen Küche inspiriertes Menü im Restaurant, mit lokalen Produkten zum Probieren."}',
      'Ristorante', ((today + 5) + time '20:00') at time zone 'Europe/Rome', ((today + 5) + time '22:30') at time zone 'Europe/Rome', 80, true, '/demo/cena-sarda.svg');

  -- servizi prenotabili
  insert into public.facilities(hotel_id, kind, name, description, default_capacity, image_url)
    values (h, 'spa', '{"it":"Percorso benessere","en":"Wellness circuit","de":"Wellness-Rundgang"}',
            '{"it":"Sauna, bagno turco e vasca idromassaggio, 60 minuti.","en":"Sauna, steam room and whirlpool, 60 minutes.","de":"Sauna, Dampfbad und Whirlpool, 60 Minuten."}', 4, '/demo/spa-percorso.svg') returning id into f_spa;
  insert into public.facilities(hotel_id, kind, name, description, default_capacity, image_url)
    values (h, 'spa', '{"it":"Massaggio rilassante","en":"Relaxing massage","de":"Entspannungsmassage"}',
            '{"it":"Massaggio di 50 minuti con un operatore.","en":"A 50-minute massage with a therapist.","de":"50-minütige Massage mit einer Therapeutin."}', 1, '/demo/massaggio-rilassante.svg') returning id into f_mas;
  insert into public.facilities(hotel_id, kind, name, description, default_capacity, image_url)
    values (h, 'pool', '{"it":"Lettini in piscina","en":"Pool sunbeds","de":"Liegen am Pool"}',
            '{"it":"Due lettini con ombrellone vicino alla piscina, mezza giornata.","en":"Two sunbeds with a parasol by the pool, half a day.","de":"Zwei Liegen mit Sonnenschirm am Pool, einen halben Tag."}', 6, '/demo/piscina-lettini.svg') returning id into f_pool;
  insert into public.facilities(hotel_id, kind, name, description, default_capacity, image_url)
    values (h, 'gamesroom', '{"it":"Sala giochi","en":"Games room","de":"Spielzimmer"}',
            '{"it":"Ping pong e calcio balilla, un''ora a tavolo.","en":"Table tennis and table football, one hour per table.","de":"Tischtennis und Tischfußball, eine Stunde pro Tisch."}', 4, '/demo/sala-giochi.svg') returning id into f_game;
  insert into public.facilities(hotel_id, kind, name, description, default_capacity, image_url)
    values (h, 'other', '{"it":"Cena al ristorante","en":"Dinner at the restaurant","de":"Abendessen im Restaurant"}',
            '{"it":"Prenota il tuo tavolo per la cena.","en":"Book your table for dinner.","de":"Reservieren Sie Ihren Tisch für das Abendessen."}', 20, '/demo/ristorante-tavolo.svg') returning id into f_rest;

  -- posti prenotabili: da oggi ai prossimi 7 giorni (solo orari ancora futuri)
  insert into public.slots(hotel_id, facility_id, starts_at, ends_at, capacity)
  select h, f.id, s.st, s.st + f.dur, f.cap
  from (values
      (f_spa,  interval '60 minutes', 4, array[time '10:00', time '11:30', time '16:00', time '17:30']),
      (f_mas,  interval '50 minutes', 1, array[time '10:00', time '11:00', time '15:30', time '16:30', time '17:30']),
      (f_pool, interval '5 hours',    6, array[time '09:00', time '14:00']),
      (f_game, interval '60 minutes', 4, array[time '16:00', time '17:00', time '21:00']),
      (f_rest, interval '90 minutes', 20, array[time '19:30', time '20:30'])
  ) as f(id, dur, cap, hrs)
  cross join lateral (
    select ((today + d) + t) at time zone 'Europe/Rome' as st
    from generate_series(0, 7) as d, unnest(f.hrs) as t
  ) s
  where s.st > now();

  -- informazioni per la reception (l'assistente risponde SOLO da qui)
  insert into public.ai_knowledge(hotel_id, category, title, content, locale, sort_order) values
  (h, 'hours',     'Orari della reception', 'La reception e'' aperta 24 ore su 24. Di notte, per urgenze, si puo'' chiamare il numero interno 9.', 'it', 10),
  (h, 'dining',    'Colazione, pranzo e cena', 'Colazione dalle 7:30 alle 10:00. Pranzo dalle 12:30 alle 14:30. Cena dalle 19:30 alle 21:30. Il ristorante e'' sulla terrazza vista mare; i tavoli della cena si prenotano dall''app.', 'it', 20),
  (h, 'pool',      'Piscina', 'La piscina e'' aperta dalle 9:00 alle 19:00. Servono cuffia e doccia prima di entrare. I lettini con ombrellone si prenotano dall''app.', 'it', 30),
  (h, 'spa',       'Centro benessere', 'Il centro benessere e'' aperto dalle 10:00 alle 19:00. Percorso benessere (sauna, bagno turco, idromassaggio) di 60 minuti e massaggi di 50 minuti su prenotazione dall''app. Vietato l''ingresso ai minori di 16 anni.', 'it', 40),
  (h, 'transport', 'Spiaggia e navetta', 'La spiaggia e'' a 300 metri, raggiungibile a piedi dal sentiero dietro la piscina. Una navetta gratuita collega il resort al paese ogni ora dalle 9:00 alle 23:00.', 'it', 50),
  (h, 'rules',     'Check-out', 'Il check-out e'' entro le 11:00. Per lasciare i bagagli dopo il check-out, rivolgersi alla reception.', 'it', 60),
  (h, 'rules',     'Animali', 'Gli animali di piccola taglia sono ammessi nelle camere ma non al ristorante ne'' in piscina.', 'it', 70),
  (h, 'contacts',  'Contatti utili', 'Reception: numero interno 9. Medico di guardia turistica: chiedere alla reception. Per ogni emergenza chiamare il 112.', 'it', 80),
  (h, 'events',    'Animazione', 'Il programma della settimana e'' nella sezione Eventi dell''app. L''animazione e'' sempre in piazzetta.', 'it', 90);

  -- avviso di benvenuto per tutti gli ospiti
  insert into public.notifications(hotel_id, kind, title, body, url)
    values (h, 'announcement',
      '{"it":"Benvenuti!","en":"Welcome!","de":"Willkommen!"}',
      '{"it":"Domani alle 19:00 aperitivo di benvenuto in terrazza. Trovate tutto il programma nella sezione Eventi.","en":"Tomorrow at 7 pm welcome aperitivo on the terrace. Find the full programme in the Events section.","de":"Morgen um 19 Uhr Willkommens-Aperitif auf der Terrasse. Das ganze Programm finden Sie im Bereich Veranstaltungen."}',
      null);
end
$seed$;

-- controllo: quante righe ci sono ora
select
  (select count(*) from public.events        where hotel_id = (select id from public.hotels where slug='hotel-prova')) as eventi,
  (select count(*) from public.facilities    where hotel_id = (select id from public.hotels where slug='hotel-prova')) as servizi,
  (select count(*) from public.slots         where hotel_id = (select id from public.hotels where slug='hotel-prova')) as posti_prenotabili,
  (select count(*) from public.ai_knowledge  where hotel_id = (select id from public.hotels where slug='hotel-prova')) as info_reception;
