import { it } from 'vitest'
import { syllabify, wordPhones } from '../syllables'
it('x', () => {
  for (const w of ['beautiful','summer','dancing','running','time','loved','wanted','places','little','table','together','shadow','window','street','lights','burning','highway','yesterday','remember','creation','lion','radio','fire','strong','thunder','golden','believe','city','heart','broken','sky','yellow','nation','music','rhythm','hmm','2','paper','river','candle','forgotten','strangers','echo','electric','dreaming','ocean','silver','morning','starlight','endless','satellite','breaking'])
    console.log(w, syllabify(w).join('-'), wordPhones(w).map(s=>`[${s.onset.join(' ')}|${s.vowels.join('')}|${s.coda.join(' ')}]${s.stress}`).join(' '))
})
