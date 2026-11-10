import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingGender, greetingKey } from '../src/lib/rules/greeting';
import { makeT } from '../src/lib/i18n';
import { LOCALES } from '../src/lib/types';

test('saluto: femminile e maschile dai nomi negli elenchi, anche con accenti e maiuscole', () => {
  assert.equal(greetingGender('Giulia', 'it'), 'f');
  assert.equal(greetingGender('Marco', 'it'), 'm');
  assert.equal(greetingGender('NICCOLÒ', 'it'), 'm');
  assert.equal(greetingGender('Zebedeo', 'it'), null, 'non in elenco: neutro');
  assert.equal(greetingGender('Nicolò', 'it'), 'm');
  assert.equal(greetingGender('Hélène', 'fr'), 'f');
  assert.equal(greetingGender('Jürgen', 'de'), 'm');
  assert.equal(greetingGender('Анна', 'ru'), 'f');
});

test('saluto: Luca, Mattia, Elia, Nicola finiscono in "a" ma non diventano femminili', () => {
  assert.equal(greetingGender('Luca', 'it'), 'm');
  assert.equal(greetingGender('Mattia', 'it'), 'm');
  assert.equal(greetingGender('Elia', 'it'), 'm');
  assert.equal(greetingGender('Nicola', 'it'), 'm');
});

test('saluto: nomi maschili in Italia e femminili altrove sono maschili solo in italiano', () => {
  for (const n of ['Andrea', 'Simone', 'Nicola', 'Michele', 'Daniele', 'Gabriele', 'Rosario']) {
    assert.equal(greetingGender(n, 'it'), 'm', n);
    assert.equal(greetingGender(n, 'de'), null, n);
    assert.equal(greetingGender(n, 'en'), null, n);
  }
});

test('saluto: nomi ambigui, sconosciuti o vuoti usano la forma neutra', () => {
  for (const n of ['Alex', 'Sasha', 'Kim', 'Robin', 'Jean', 'Wei', 'Xyz', '', '   ', null, undefined]) {
    assert.equal(greetingGender(n as string, 'it'), null, String(n));
  }
});

test('saluto: nomi composti', () => {
  assert.equal(greetingGender('Maria Grazia', 'it'), 'f');
  assert.equal(greetingGender('Anna-Maria', 'it'), 'f');
  assert.equal(greetingGender('Gian Luca', 'it'), 'm');
  assert.equal(greetingGender('Gian Maria', 'it'), null, 'non si indovina dal primo nome');
  assert.equal(greetingGender('Jean-Pierre', 'fr'), null);
});

test('saluto: frasi in italiano, spagnolo e portoghese; chiavi presenti in tutte le 12 lingue', () => {
  const it = makeT('it');
  assert.equal(it(greetingKey('home.welcome', 'f'), { name: 'Giulia' }), 'Benvenuta, Giulia');
  assert.equal(it(greetingKey('home.welcome', 'm'), { name: 'Marco' }), 'Benvenuto, Marco');
  assert.equal(it(greetingKey('home.welcome', null), { name: 'Alex' }), 'Ti diamo il benvenuto, Alex');
  assert.equal(makeT('es')(greetingKey('home.welcome', 'f'), { name: 'Lucía' }), 'Bienvenida, Lucía');
  assert.equal(makeT('pt')(greetingKey('home.welcome', 'm'), { name: 'João' }), 'Bem-vindo, João');
  for (const l of LOCALES) {
    for (const k of ['home.welcomeF', 'home.welcomeM', 'home.welcomeNewF', 'home.welcomeNewM']) {
      assert.notEqual(makeT(l)(k, { name: 'X', hotel: 'H' }), k, `${l} ${k}`);
    }
  }
});
