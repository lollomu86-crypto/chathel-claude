// Saluto della Home al maschile o al femminile (decisione di Lorenzo del 10/11/2026: "Benvenuta" per i nomi femminili,
// "Benvenuto" per quelli maschili). L'app non chiede il genere: lo si ricava SOLO dal nome di battesimo, con due elenchi.
// Regole:
//  - niente regole sulla desinenza ("finisce in a"): Andrea, Luca, Nicola, Mattia, Elia sono maschili;
//  - nome ambiguo o sconosciuto => null => forma neutra ("Ti diamo il benvenuto"), cosi' nessuno riceve il saluto sbagliato;
//  - alcuni nomi sono maschili in Italia e femminili altrove (Andrea, Simone, Nicola, Michele, Daniele, Gabriele):
//    maschili solo se l'ospite usa l'app in italiano, altrimenti neutri;
//  - il risultato non si salva da nessuna parte: si calcola al momento, solo per scegliere la frase.
import type { Locale } from '../types';

export type Gender = 'f' | 'm';

const FEMALE = new Set(`
ada adele adriana agata agnese alba alberta alessandra alessia alice alida allegra alma amalia ambra amelia anastasia
angela angelica angelina anita anna annalisa annamaria antonella antonia arianna asia assunta aurora azzurra barbara
beatrice benedetta bianca brigida bruna camilla carla carlotta carmela carmen carolina caterina cecilia chiara cinzia
clara claudia clelia concetta cristiana cristina dalila daniela debora delia diana dora eleonora elena elisa elisabetta
elvira emanuela emilia emma erica erika ester eva fabiana fabrizia federica fernanda filomena fiorella flavia franca
francesca gaia gemma georgia giada gianna gina ginevra gioia giorgia giovanna gisella giulia giuliana giuseppina gloria
grazia graziella ilaria ines irene iris isabella italia jessica laura lavinia lea letizia licia lidia lina linda lisa
livia loredana lorena lorenza luana lucia luciana lucrezia luisa maddalena manuela mara marcella margherita maria
mariagrazia mariangela marianna marika marina marisa marta martina matilde melissa michela milena mirella miriam monica
nadia natalia nicoletta noemi norma olga ornella ottavia paola patrizia piera pietra raffaella rebecca renata rita
roberta romina rosa rosalba rosanna rosaria rossella sabrina samanta sandra sara serena silvana silvia simona sofia
sonia stefania susanna tamara teresa tiziana valentina valeria vanessa vera veronica viola virginia vittoria viviana
wanda zoe
abigail amanda amber amy anne annie ashley audrey betty bridget brittany caroline catherine charlotte chloe christine
claire diane dorothy elizabeth ellen emily emmanuelle evelyn fiona grace hannah heather helen helena hayley isabel
jane janet jennifer jenny joanna josephine judith julia julie karen kate katherine kathleen kelly laura lauren lily
lucy madison margaret marie mary megan michelle molly nancy natalie nicole olivia pamela penelope rachel rose ruth
samantha sarah scarlett sharon sophie stephanie susan victoria virginie wendy
anke annika birgit brigitte christa christiane claudia doris elke frauke gabriela gertrud gisela greta hanna heike
heidi helga ines ingrid jana jutta karin katharina katja kerstin lena lisa magdalena margit marlene martina mechthild
melanie monika nadine petra renate sabine silke steffi susanne tanja ulrike ursula ute wiebke
agnes amelie anais aurelie beatrice brigitte cecile celine christelle clemence delphine elodie eloise emilie fabienne
florence francoise genevieve helene isabelle josephine laetitia lea lucie madeleine manon margot marion mathilde
melanie monique nathalie oceane pauline sandrine solene sylvie valerie veronique
alba alicia ana araceli beatriz carmen catalina concepcion consuelo dolores elena encarnacion esperanza estefania
eugenia guadalupe ines inmaculada isabel juana leticia lorena lourdes lucia luz marta mercedes montserrat nerea
paloma pilar raquel rocio rosario soledad susana teresa ximena yolanda
adriana bruna conceicao fernanda gabriela joana leonor luisa margarida mariana matilde rafaela rita sofia
anouk femke fleur ineke janneke lieke lotte maaike marieke mieke noor saskia sanne
agnieszka aleksandra alicja barbara beata dorota edyta ewa grazyna halina iwona jadwiga joanna justyna kasia katarzyna
magdalena malgorzata marta monika natalia paulina renata zofia
astrid elin elsa ebba frida ingrid karin linnea maja sigrid
alena blanka hana ivana jitka lenka marketa pavla petra radka sarka tereza veronika zuzana
alina anastasiya darya ekaterina galina irina katya ksenia larisa lyudmila nadezhda natalya oksana olesya svetlana
tatiana tatyana valentina vera yulia yelena
анна мария елена ольга наталья наталия екатерина татьяна ирина светлана юлия анастасия дарья ксения алина марина
людмила галина вера надежда валентина полина софия виктория
`.trim().split(/\s+/));

const MALE = new Set(`
achille adriano agostino alberto aldo alessandro alessio alfredo alvise amedeo angelo antonio armando arturo attilio
augusto aurelio bartolomeo battista benedetto bernardo bruno carlo carmelo cesare christian ciro claudio corrado cosimo
cristian cristiano dario davide diego dino domenico donato edoardo elia elio emanuele emilio enrico enzo ercole ernesto
ettore eugenio fabio fabrizio federico felice ferdinando filippo flavio francesco franco gabriel gaetano gennaro
giacomo giancarlo gianfranco gianluca gianmarco gianni gianpaolo gino giorgio giovanni giulio giuseppe graziano
guglielmo guido ignazio ivan jacopo lamberto leonardo lino lorenzo luca luciano luigi manuel marcello marco mario
massimiliano massimo matteo mattia maurizio mauro michelangelo mirko nazario niccolo nicolo nino oreste orlando osvaldo
ottavio paolo pasquale patrizio piero pietro raffaele renato riccardo roberto rocco romano rosario ruggero salvatore
samuele sandro saverio sebastiano sergio silvio stefano tommaso tullio ugo umberto valentino valerio vincenzo vito
vittorio walter
aaron adam albert alfred andrew anthony arthur benjamin bernard brian charles christopher colin daniel david dennis
donald douglas dylan edward eric ethan frank frederick gary george gordon gregory harry henry howard jack jacob
james jason jeffrey john jonathan joseph joshua justin keith kenneth kevin lawrence liam louis mark martin matthew
michael nathan neil nicholas noah oliver oscar patrick paul peter philip richard robert ronald ryan samuel scott
sean simon stephen steven thomas timothy tom tyler victor william
andreas bernd dieter dirk florian frank friedrich gerhard gunther hans heinz helmut holger jan jens jorg jurgen karl
klaus lars lukas manfred markus matthias moritz niklas norbert olaf ralf reinhard rolf rudolf sebastian stefan sven
thorsten tobias torsten ulrich uwe volker werner wolfgang
alain antoine arnaud baptiste benoit bertrand christophe clement didier etienne fabien francois gerard gilles
guillaume herve jacques jerome julien laurent lionel loic mathieu maxime nicolas olivier pascal philippe pierre remi
sebastien stephane sylvain thibault thierry vincent xavier yann yves
alejandro alfonso alvaro andres angel carlos cesar diego eduardo enrique esteban fernando gonzalo guillermo ignacio
javier jesus jorge jose juan julian luis manuel miguel pablo pedro rafael ramon raul ricardo rodrigo santiago sergio
tomas
afonso bernardo diogo duarte goncalo joao miguel nuno rui tiago vasco
bram daan geert hendrik jeroen joost kees koen maarten pieter ruud sander thijs wouter
adam bartosz dariusz grzegorz jakub jaroslaw kamil krzysztof lukasz maciej marcin mariusz michal piotr rafal
slawomir tomasz wojciech zbigniew
anders bjorn erik fredrik gustav henrik johan magnus mats nils olof oskar per stig ulf
jiri josef karel ladislav milan miroslav ondrej pavel petr radek stanislav vaclav vojtech zdenek
aleksandr aleksei alexei alexey andrei anton artem boris dmitri dmitry evgeny fyodor igor ilya konstantin maksim
mikhail nikolai oleg pavel roman sergei sergey vladimir vladislav yuri
александр алексей андрей антон артем артём борис владимир дмитрий евгений игорь иван илья константин максим
михаил николай олег павел роман сергей юрий
`.trim().split(/\s+/));

/** Maschili in Italia, femminili (o ambigui) in altri paesi: maschili solo per chi usa l'app in italiano. */
const MALE_IF_ITALIAN = new Set(['andrea', 'simone', 'nicola', 'michele', 'daniele', 'gabriele', 'rosario']);

/** Nomi di entrambi i generi: sempre forma neutra, anche se comparissero in un elenco. */
const AMBIGUOUS = new Set(['alex', 'sasha', 'sascha', 'саша', 'kim', 'robin', 'jean', 'jordan', 'charlie', 'sam', 'ariel',
  'eli', 'toni', 'dominique', 'claude', 'camille', 'celeste', 'andrea', 'simone', 'nicola', 'michele', 'daniele', 'gabriele',
  'chris', 'jo', 'lee', 'morgan', 'taylor', 'jamie', 'jesse', 'noa', 'nikita', 'никита']);

function normalize(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // toglie gli accenti: "Niccolò" -> "niccolo"
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, ' ')
    .trim();
}

function lookup(word: string, locale: Locale): Gender | null {
  if (!word) return null;
  if (MALE_IF_ITALIAN.has(word)) return locale === 'it' ? 'm' : null;
  if (AMBIGUOUS.has(word)) return null;
  const f = FEMALE.has(word), m = MALE.has(word);
  if (f === m) return null; // in nessun elenco, o (per errore) in entrambi
  return f ? 'f' : 'm';
}

/**
 * Genere grammaticale per il saluto, dal nome di battesimo. null = non si sa: usare la forma neutra.
 * Nomi composti ("Maria Grazia", "Gian-Luca"): vale il nome intero se e' negli elenchi, altrimenti il primo nome.
 */
export function greetingGender(givenName: string | null | undefined, locale: Locale): Gender | null {
  const n = normalize(givenName ?? '');
  if (!n) return null;
  const joined = n.replace(/[\s-]+/g, '');
  return lookup(joined, locale) ?? lookup(n.split(/[\s-]+/)[0], locale);
}

/** Chiave del messaggio: `base` (neutra), `baseF` o `baseM`. */
export function greetingKey(base: string, gender: Gender | null): string {
  return gender === 'f' ? `${base}F` : gender === 'm' ? `${base}M` : base;
}
