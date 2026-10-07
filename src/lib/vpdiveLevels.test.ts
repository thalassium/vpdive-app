import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromVpdive, teachingLevelOf, type VpdiveQualif } from './vpdiveLevels';
import { aptitudesFromLabels } from './palanquees';

const t = (code: string, name: string): VpdiveQualif => ({ family: 'teaching', code, name });
const l = (code: string, name: string): VpdiveQualif => ({ family: 'level', code, name });
const q = (code: string, name: string): VpdiveQualif => ({ family: 'qualification', code, name });

// Libellés réels de VPDive (référentiel et inscrits, octobre 2026).
const DEJEPS3 = t('DEJEPS - activité de plongée sub.', "P - Enseignant 3 - Diplôme d'Etat de la Jeunesse et de l'Education Populaire - activités de plongée subaquatique");
const DEJEPS4 = t('DEJEPS - plongée sub.', "P - Enseignant 4 - Diplôme d'Etat de la Jeunesse et de l'Education Populaire - plongée subaquatique");
const BPJEPS = t('BPJEPS - avec scaphandre', "P - Enseignant 2 - Brevet Prof. de la Jeunesse, de l'Education Populaire et du Sport - Option A : Avec Scaphandre\"");
const BEES3 = t('BEES3-P', "P - Enseignant 5 - Brevet d'Etat d'Educateur Sportif 3° - option Plongée subaquatique");
const MF1 = t('E3', 'P - Enseignant 3 - Moniteur Fédéral - 1 er degré');
const MF2 = t('E4', 'P - Enseignant 4 - Moniteur Fédéral - 2 ème degré');
const E2 = t('E2', 'P - Enseignant 2 - Initiateur&P4 (Directeur de Bassin & N4/P4)');
const E1 = t('E1', 'P - Enseignant 1 - Initiateur (Directeur de bassin)');
const MFAS = t('MF-AS', 'P - E3 Moniteur plongée Associé');
const OWSI = t('OWSI / AI', 'Padi - Assistant instructeur / Assistant Instructor');
const IE2 = t('IE2', 'A - Initiateur - Entraineur 2 apnée');

test('prérogative d’enseignement lue dans le nom VPDive, pas déduite du diplôme', () => {
  assert.equal(teachingLevelOf(DEJEPS3), 3, 'Jade : DEJEPS activité de plongée = E3');
  assert.equal(teachingLevelOf(DEJEPS4), 4, 'DEJEPS plongée sub. = E4');
  assert.equal(teachingLevelOf(BPJEPS), 2);
  assert.equal(teachingLevelOf(BEES3), 4, 'Enseignant 5 traité en E4');
  assert.equal(teachingLevelOf(MF1), 3);
  assert.equal(teachingLevelOf(MFAS), 3);
});

test('affichage : la prérogative vient à part, le diplôme tel que VPDive l’écrit', () => {
  assert.deepEqual(fromVpdive([DEJEPS3]), { labels: ['E3'], display: ['DEJEPS'] });
  assert.deepEqual(fromVpdive([DEJEPS4]).display, ['DEJEPS']);
  assert.deepEqual(fromVpdive([MF1]).display, ['MF1']);
  assert.deepEqual(fromVpdive([MF2]).display, ['MF2']);
  assert.deepEqual(fromVpdive([E2]).display, ['Initiateur + N4']);
  assert.deepEqual(fromVpdive([E1]).display, ['Initiateur']);
  assert.deepEqual(fromVpdive([MFAS]).display, ['MF-AS']);
  assert.deepEqual(fromVpdive([BPJEPS]).display, ['BPJEPS']);
});

test('les diplômes d’autres écoles ou d’autres activités ne donnent pas de prérogative', () => {
  const r = fromVpdive([l('P4-ANMP', 'P-Plongeur Niveau 4 (P4-N4)'), MF1, OWSI]);
  assert.deepEqual(r.labels, ['P4-ANMP', 'E3']);
  assert.deepEqual(r.display, ['P4-ANMP', 'MF1', 'OWSI / AI'], 'le diplôme PADI reste visible');
  assert.deepEqual(fromVpdive([IE2]), { labels: [], display: [] }, 'apnée : ni prérogative ni affichage');
});

test('le bruit (secourisme, nitrox, tuteur…) n’est pas affiché, les aptitudes PE/PA le sont', () => {
  const r = fromVpdive([q('RIFA-P', 'P - Réaction et intervention face à un accident - Plongée'), q('MNC', 'P - Moniteur Nitrox Confirmé'), q('PE-40', 'P - Plongeur encadré à 40m'), q('TSI', 'P - Tuteur de Stage Initiateur')]);
  assert.deepEqual(r.display, ['PE-40']);
  assert.equal(aptitudesFromLabels(r.labels).teach, 0, '« Tuteur de stage Initiateur » ne rend pas initiateur');
});

test('P5-DPE (rangé en qualification) est affiché ; un niveau d’archéologie ne l’est pas', () => {
  assert.deepEqual(fromVpdive([q('P5-DPE', 'P - Plongeur Niveau 5 - Directeur de Plongée en Exploration')]).display, ['P5-DPE']);
  assert.deepEqual(fromVpdive([l('P4', 'P - Plongeur(se) Niveau 4 (P4-N4 - Guide de palanquée)'), l('PA1', 'AS - Plongeur(se) Archéologue 1er degré')]).display, ['P4']);
});

test('de bout en bout : Jade Chevassu est E3, pas MF1', () => {
  const r = fromVpdive([DEJEPS3]);
  const a = aptitudesFromLabels(r.labels);
  assert.equal(a.teach, 3);
  assert.equal(a.guide, 'E3');
  assert.deepEqual(r.display, ['DEJEPS']);
});
