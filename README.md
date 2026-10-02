# Tontreffer

Üben, einen Ton zu treffen, und aus ein paar gesungenen Tönen die eigene Skala
ableiten. Läuft im Browser, ohne Konto, ohne Server, ohne Werbung. Alles bleibt auf
dem Gerät.

**Online:** https://wederw.github.io/tontreffer/ (auch auf dem Handy)

## Starten

**PC:** `index.html` im Browser öffnen (Chrome, Edge oder Firefox). Der Browser fragt
einmal nach dem Mikrofon. Eine lokal geöffnete Datei gilt als sicher, deshalb geht das
ohne Server.

Falls der Browser trotzdem ablehnt: im Ordner `python -m http.server 8000` starten und
`http://localhost:8000` öffnen.

**Handy:** Browser geben das Mikrofon nur frei, wenn die Seite über **https** kommt.
Ein Aufruf über das WLAN (`http://192.168.…`) reicht nicht. Deshalb liegt die App
auf GitHub Pages (Adresse oben). Jeder Push auf `main` aktualisiert sie nach etwa
einer halben Minute.

## Was die App kann

**Ton treffen**
- Ziel aus einem Raster (5- bis 72-EDO, Grundton frei wählbar) oder aus der eigenen Skala
- Ziel anhören. Solange der Bezugston klingt, misst die App nicht, damit sie nicht den
  Lautsprecher misst.
- Abweichung live in Cent, als Zahl und als Nadel. Standard ist die **ruhige Anzeige**:
  - Die Tonhöhe ist mit 0.3 s Zeitkonstante gedämpft.
  - Die Zahl ändert sich höchstens viermal pro Sekunde.
  - Der Zielbereich hat eine Hysterese.
  - Kurze Aussetzer bis 0.35 s werden überbrückt.

  Ohne diese Dämpfung regelt man mit der eigenen Reaktionszeit gegen Rauschen und
  Vibrato an und pendelt um das Ziel. Die direkte Anzeige zeigt jeden Messwert.
- Rückmeldung **„Erst danach“**: Beim Singen zeigt die App nichts an. Sobald du
  absetzt, kommt das Ergebnis, also die Mitte des gehaltenen Tons ohne Einschwingen
  und Ausklang.
- Verlauf der letzten 8 Sekunden, mit Zielbereich, Nachbarschritten des Rasters und
  12-TET-Lagen
- Ein Treffer zählt, wenn die Stimme ±5 bis ±30 ¢ um das Ziel 0.3 bis 1 s hält.
  Danach steht in der Liste die Mitte, die Streuung und die Zeit bis zum Treffer.
- Zufallsmodus: nach jedem Treffer ein neues Ziel, über eine oder zwei Oktaven
- „Oktave egal“: ein Ziel zählt auch in einer anderen Oktave

**Skala finden**
- Einzelne Töne singen, mit kurzen Pausen dazwischen
- Die App zerlegt die Aufnahme in Töne und misst für jeden Mitte, Streuung und Vibrato
  (Rate in Hz, Tiefe in ¢).
- Alle Töne werden auf eine Oktave über dem Bezugston gefaltet. Töne, die weniger als
  20, 35 oder 50 ¢ auseinanderliegen, werden zu einer Stufe zusammengefasst.
- Für jede Stufe zeigt sie Cent, Abstand zur vorigen, nächsten einfachen Bruch und
  12-TET-Namen.
- Sie sucht das kleinste gleichstufige Raster, das alle Stufen auf ±5, ±10 oder ±20 ¢
  trifft, mit einem Diagramm des größten Fehlers für 5- bis 72-EDO.
- Export als `.scl`, oder als `.ascl` für Live 12 (gleiches Format wie der
  Mikrotonale Synth)
- „Zum Üben verwenden“ macht die gefundene Skala zum Zielraster.

## Dateien

```
index.html          Oberfläche
pitch.js            Messung und Auswertung, im Browser und in Node nutzbar
test/pitch.test.js  Tests mit künstlichen Signalen: node --test
```

## Wie gemessen wird

- **Tonhöhe:** YIN (de Cheveigné & Kawahara 2002). Für jede Verschiebung τ wird
  `d(τ) = Σ (x_j − x_{j+τ})²` gebildet und normiert. Das erste Tal unter 0.15 ist die
  Periode T, eine Parabel durch drei Punkte liefert Bruchteile eines Samples.
  `f = Abtastrate / T`.
- **Messbereich und Puffer:** 60 bis 1500 Hz. Der Puffer ist so lang, dass die längste
  Periode 2,5-mal hineinpasst (2048 Samples bei 48 kHz).
- **Was nicht gemessen wird:** Echo-Unterdrückung, Rauschfilter und automatische
  Pegelanpassung des Browsers sind aus. Alles unter der eingestellten Empfindlichkeit
  (dBFS) wird ignoriert.
- **Wann ein Ton ein Ton ist:** Ein neuer Ton beginnt, wenn die Tonhöhe länger als
  0.12 s mehr als 45 ¢ vom Median der letzten 0.6 s abweicht, oder nach mehr als 0.15 s
  Stille. Vibrato-Ausschläge, die zurückkommen, gehören zum Ton.
- **Mitte eines Tons:** Einschwingen und Ausklang (je 15 %) fallen weg. Ohne Vibrato ist
  die Mitte der Median, mit Vibrato der Mittelwert, weil die meisten Werte dann an den
  Umkehrpunkten liegen.
- **Vibrato:** Gerade abziehen, Nulldurchgänge zählen. Die Tiefe ist √2 mal der
  Effektivwert, korrigiert um die Dämpfung durch das Analysefenster
  (`sinc(π · Rate · Fensterlänge)`).

## Geprüft

- `node --test`: 12 Tests mit künstlichen Signalen
  - Sinus, Sägezahn, stimmähnlicher Klang mit schwachem Grundton
  - Rauschen und Stille
  - Vibrato bis ±100 ¢
  - Legato in 75-¢-Schritten
  - eine gesungene Mavila-Folge, aus der 16-EDO herauskommen muss
- Durchlauf in Chrome (headless) mit einer WAV-Datei als Mikrofon:
  - Treffen: ein Ton 3 ¢ über 220 Hz ergibt den Treffer „+3.0 ¢“.
  - Skala: dieselbe Mavila-Folge ergibt 10 Töne, 7 Stufen, ±2.5 ¢ an den Sollwerten
    und 16-EDO als kleinstes Raster bei ±10 ¢.
- **Nicht geprüft:** ein echtes Mikrofon mit echter Stimme und echte Handys.

## Grenzen

- Die App erwartet **eine** Stimme. Begleitung, Hall oder ein zweiter Sänger stören die
  Messung.
- Die eigene Skala wiederholt sich nach jeder Oktave (2/1). Skalen ohne Oktavgleichheit
  bildet sie nicht ab.
