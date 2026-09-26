'use strict';

const { analysiereDateiname } = require('../src/utils/fotoDateiname');

describe('analysiereDateiname', () => {
  test.each([
    ['MBH004.jpg', 'MBH004'],
    ['MXO038.png', 'MXO038'],
    ['SAH120.gif', 'SAH120'],
    ['OXO001.jpeg', 'OXO001'],
    ['MBH004_2.jpg', 'MBH004'],
    ['MBH004_12.png', 'MBH004'],
    ['MBH004.JPG', 'MBH004'],
    ['MBH004.Jpeg', 'MBH004'],
    ['mbh004.jpg', 'MBH004'],
  ])('%s → Basis %s', (datei, basis) => {
    expect(analysiereDateiname(datei)).toEqual({ status: 'ok', basis });
  });

  test.each([
    ['MBH004_MBH005.jpg', ['MBH004', 'MBH005']],
    ['MBH004 MBH005.png', ['MBH004', 'MBH005']],
    ['MBH004-MBH005.jpg', ['MBH004', 'MBH005']],
    ['MBH004,MBH005.jpg', ['MBH004', 'MBH005']],
    ['MBH004, MBH005.jpg', ['MBH004', 'MBH005']],
    ['MBH004+MXO038.jpg', ['MBH004', 'MXO038']],
    ['MBH004_2_MBH005.jpg', ['MBH004', 'MBH005']],
    ['mbh004_mbh005_mbh006.jpg', ['MBH004', 'MBH005', 'MBH006']],
  ])('%s → mehrere Nummern %j', (datei, nummern) => {
    expect(analysiereDateiname(datei)).toEqual({ status: 'mehrere', nummern });
  });

  test.each(['MEH.jpg', 'MPA.jpg', '123.jpg', 'foto.png', 'MBH004A.jpg'])(
    '%s → ohne gültige Artikelnummer',
    (datei) => {
      expect(analysiereDateiname(datei)).toEqual({ status: 'ohneNummer' });
    },
  );

  test.each(['MBH004-2.jpg', 'MBH004 (1).jpg', 'MBH004_1_2.jpg', 'MBH004 kopie.jpg'])(
    '%s → eine Nummer, aber kein eindeutiger Name',
    (datei) => {
      expect(analysiereDateiname(datei)).toEqual({ status: 'unklar' });
    },
  );

  test.each(['MBH004.webp', 'MBH004.pdf', 'MBH004', 'Thumbs.db', '.DS_Store'])(
    '%s → unerlaubte Endung',
    (datei) => {
      expect(analysiereDateiname(datei)).toEqual({ status: 'endung' });
    },
  );
});
