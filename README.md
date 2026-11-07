# Atomic Blast

Rodinná hra na motivy Bombermana, běží v prohlížeči. Jeden soubor `index.html`, bez závislostí.

**Hrát online (bez instalace):** https://vitakul.github.io/atomic-blast/

## Režimy

| Režim | Ovládání |
|---|---|
| 1 hráč proti počítači | WASD + mezerník |
| 2 hráči u jedné klávesnice | hráč 1: WASD + mezerník · hráč 2: šipky + Enter |
| Kampaň (příšery, klíč, portál, 3 životy) | WASD + mezerník |
| Společná výprava – 2 hráči spolu (kooperace) | hráč 1: WASD + mezerník · hráč 2: šipky + Enter |
| Po Wi-Fi, až 3 hráči, každý u svého počítače (aréna nebo výprava) | šipky nebo WASD (každý si vybere), mezerník = bomba |

Esc kdykoli vrátí do menu.

## Společná výprava (kooperativní kampaň)

Hráči procházejí jedenáct navazujících bludišť, každé s jinou grafikou a úkolem. Nesoupeří, spolupracují:

| Level | Prostředí | Úkol |
|---|---|---|
| 1 | Les | zničit všechny příšery |
| 2 | Jeskyně | najít 3 klíče schované pod cihlami |
| 3 | **Bažina** (nová) | osvobodit 3 zvířátka – odpálit klec bombou a pak se zvířátka dotknout |
| 4 | Ledová pevnost | stoupnout si **oba zároveň** na dva spínače v protilehlých koutech |
| 5 | **Krystalový důl** (nový) | posbírat 10 krystalů (6 leží volně, 4 jsou pod cihlami) |
| 6 | Lávové doly | zničit hnízdo (3 zásahy ohněm), ze kterého se líhnou příšery, a pak dočistit mapu |
| 7 | **Pyramida** (nová) | šlápnout na 4 runy popořadě 1→2→3→4; špatná runa = znovu od jedničky |
| 8 | **Noční hřbitov** (nový) | ve tmě zapálit bombou 4 pochodně – každá hoří jen chvíli (30 s, lehká 40 s, těžká 22 s), musí hořet všechny naráz |
| 9 | Hrad | 2 klíče + zničit všechny příšery (včetně obrněnců na 3 zásahy) |
| 10 | **Továrna** (nová) | vydržet 60 s (lehká 50 s, těžká 70 s) – příšery pořád přicházejí, ke konci po dvou |
| 11 | Bossova komnata | porazit bosse – jednoho z pěti (viz **Bossové** níže) |

Úvod každého levelu představí nové příšery i nové věci (klece, krystaly, runy, pochodně…). Ve Továrně
ukazuje časomíra nahoře červeně, kolik zbývá vydržet; na Nočním hřbitově je vidět jen kolem hráčů,
ohně a hořících pochodní.

Pravidla:

- **Nikdo nevypadne ze hry.** Kdo umře, chvíli čeká a pak se vrátí (vedle spoluhráče, jinak na startu,
  vždy na bezpečném místě; 2,5 s bliká a je nezranitelný). Čekání roste s každou smrtí v daném levelu:
  5 s, 10 s, 15 s, dál už vždy 20 s; v dalším levelu se počítá od začátku. Odpočet vidí mrtvý i spoluhráč
  (v HUD a nad tělem). Žádné společné životy ani konec výpravy nejsou – když padnou oba naráz, oba jen
  čekají. Počet smrtí se jen počítá do statistiky (☠ v HUD a na konci).
- **Oživovací srdce ❤️.** Dokud někdo čeká na oživení, může z rozbité cihly (18 %) nebo zabité příšery (35 %)
  vypadnout červené srdce. Jakmile ho živý hráč sebere, čekající spoluhráč se vrátí hned (na bezpečné místo,
  s nesmrtelností). Když nikdo nečeká, srdce nepadá; na mapě je vždy nejvýš jedno.
- **Friendly fire je vypnuté**: plamen spoluhráče ti neublíží, vlastní bomba ano. V nastavení se dá zapnout.
- Portál je vidět od začátku, otevře se po splnění úkolu; stačí, když do něj vejde jeden hráč.
- Úkol levelu je pořád vidět v HUD („Úkol: …“), mezi levely se ukáže název a úkol dalšího bludiště.
- Příšery: balónek, duch (prochází cihlami), lovec (pronásleduje), **střelec** (střílí ohnivou kouli po řádku,
  když tě vidí) a **obrněnec** (pomalý, 3 zásahy). Bossové mají vlastní sekci níže.
- Příšery se schopnostmi přibývají s levely; v úvodu levelu se nové příšery představí s popisem:

  | Příšera | Od levelu | Co umí |
  |---|---|---|
  | Žabák | 1 Les | občas skočí o dvě políčka – přes cihlu, bombu i oheň; ve skoku ho oheň nechytí |
  | Sliz | 1 Les | po zásahu se rozdělí na dva malé, rychlejší slizy |
  | Krtek | 2 Jeskyně | zahrabe se (nezranitelný, leze pod cihlami) a vyleze poblíž hráče; chvíli bliká a ještě nezraňuje |
  | Pavouk | 2 Jeskyně | nechává pavučiny, ve kterých hráč jde pomalu; oheň je spálí, samy zmizí po chvíli |
  | Sněhulák | 4 Ledová pevnost | hází sněhové koule, které hráče na ~2 s zmrazí; spoluhráč ho rozmrazí dotykem (2 zásahy) |
  | Netopýr | 5 Krystalový důl | rychle létá cik-cak, přes cihly i bomby |
  | Hltoun | 6 Lávové doly | jde po bombách a power-upech (ne zlatých) a polyká je; po třetí bombě praskne a vybuchne (zraní každého) |
  | Mumie | 7 Pyramida | jde po hráčích, vydrží 2 zásahy; po prvním se rozmotá a zrychlí |
  | Chameleon | 8 Noční hřbitov | střídavě se zneviditelní a v neviditelnosti se plíží k hráči |
  | Bombík | 10 Továrna | když je hráč blízko, položí vlastní bombu (zraní každého) a chvíli ho oheň nechytí |

  Hnízdo občas vylíhne i sliz, Velký Bombus volá na pomoc i žabáky a slizy.
- Skóre je společné; power-upy se přenášejí do dalšího levelu (po smrti o jeden stupeň níž).
- **Zlaté power-upy** – viz níže.
- Obtížnost (lehká · normální · těžká) mění rychlost a počet příšer a životy bosse.

### Bossové

V Bossově komnatě čeká jeden z pěti bossů. **Vylosuje se hned při startu výpravy** (lokálně i na serveru;
po Wi-Fi ho server pošle klientům ve stavu hry), takže se až v posledním levelu dozvíte, na koho jste narazili.
V nastavení výpravy (lokálně i v lobby po Wi-Fi) se dá místo **🎲 NÁHODNÝ** vybrat konkrétní boss.
Úvod levelu ukáže jméno bosse a jak na něj; při začátku boss levelu zazní krátká hrozivá znělka.
Každý boss má fázi **zuřivost** (při polovině životů), vlastní hlášky v dialogovém okně nahoře a ukazatel
životů dole.

| Boss | Jak ho porazit | Zuřivost | Životy (lehká/normální/těžká) |
|---|---|---|---|
| 👹 **Velký Bombus** | zraňuje ho jen oheň z bomb; boří cihly a volá pomocníky | zrychlí a střílí do čtyř stran | 8 / 12 / 16 |
| 🐍 **Had Syčoun** | dlouhé tělo z článků se plazí po bludišti a pořád dorůstá. Oheň hada přesekne – všechno za zasaženým článkem odpadne (z velkého kusu se může vyklubat sliz). Hlava je zranitelná, **až když má had nejvýš 2 články** (bliká červeně); po zásahu se zase natáhne | zrychlí, roste rychleji a plive oheň | 3 / 4 / 5 zásahů do hlavy |
| 🧙 **Mág Iluzín** | teleportuje se a vyčaruje 2–4 své kopie. Zranitelný je **jen pravý** – kopie po zásahu nebo dotyku prasknou. Pravého poznáte tak, že jen on kouzlí (rozzáří hůl) a střílí magické střely; kopie se občas zatřpytí | teleportuje se častěji, víc kopií, vyvolá duchy | 4 / 6 / 8 |
| 👯 **Dvojčata Ohnivák a Ledovák** | Ohnivák střílí oheň, Ledovák mrazí (kamarád rozmrazí dotykem). Poražené dvojče leží a **za 8 / 6 / 4,5 s se zvedne** s půlkou životů – musíte porazit oba skoro naráz | zrychlí a střílejí častěji | 3 / 4 / 5 každé |
| 🗿 **Obr Balvan** | má kamennou kůži – oheň mu neublíží. Když zvedne nohu (červený vykřičník), dupne: otřese se obraz a ze stropu padá kamení (padá na stíny, hlavně u hráčů; dopadlé kamení zůstane jako cihla). **Po dupnutí je chvíli omráčený** (hvězdičky) – jen tehdy ho oheň zraní a nikoho při dotyku nezraní | dupe častěji, padá víc kamení | 4 / 6 / 8 |

Obtížnost u bossů mění životy i rychlost (pohyb, růst hada, střelba, jak dlouho je obr omráčený, za jak
dlouho se dvojče zvedne).

### Konec výpravy

Po poražení bosse se boss v záběru třese, bliká a postupně vybuchuje, pak velký výbuch s otřesem obrazovky,
zábleskem a částicemi a nápis „BOSS PORAŽEN!“. Následuje **vítězná obrazovka**: pixelový nadpis VÍTĚZSTVÍ!,
ohňostroj, hodnocení 1–3 hvězdičkami (podle počtu smrtí na hráče), statistiky výpravy (čas, poražené příšery,
smrti, sebrané zlaté schopnosti, skóre), tabulka hrdinů (smrti, příšery, zásahy bosse, zlaté schopnosti),
kdo zasadil poslední ránu a rolující titulky. Hraje chiptune vítězná fanfára a pak smyčka – vše je
syntetizované v prohlížeči přes Web Audio API (square/triangle oscilátory a šumové bicí), žádné zvukové soubory.
**Enter** = zpět do menu (po Wi-Fi zpět do lobby; server se do lobby vrátí sám, obrazovka zůstane, dokud
hráč nestiskne Enter).

### Zlaté power-upy (speciální schopnosti)

Vzácný zlatý power-up – zlatá zářící dlaždice s třpytkami a ikonou schopnosti. V každém levelu (kromě
bossovy komnaty) je jeden schovaný pod náhodnou cihlou; navíc může výjimečně vypadnout z jiné cihly (2 %)
nebo z příšery (5 %). Na mapě je vždy nejvýš jeden a oheň ho nezničí.

- Hráč má **nejvýš jednu zlatou schopnost** – nová nahradí starou.
- Schopnost **přetrvává mezi levely** a zmizí, až když hráč umře (štít se navíc spotřebuje, když tě zachrání).
- Po sebrání se dole na obrazovce na pár vteřin ukáže, kdo co dostal a co to umí. V HUD je u hráče
  ⭐ + ikona + název, kolem hráče zlatá záře a ikonka nad hlavou.

| Schopnost | Co umí |
|---|---|
| 👻 Průchod cihlami | procházíš cihlami (jsi v nich průhledný); v cihle ale bombu nepoložíš |
| 🛡️ Štít | jednou tě zachrání před smrtí (oheň, příšera, střela, boss), pak praskne; kolem hráče modrá bublina |
| 📡 Rozbuška | tvoje bomby samy nevybuchnou (pojistka 10 s); když už nemáš volnou bombu, další stisk odpálí tu nejstarší. Bomby na rozbušku mají zlatý kroužek |
| 🧯 Nehořlavost | plameny z bomb ti neublíží – ani vlastní, ani bombíkovy (ohnivé koule střelce ano) |
| 🧲 Magnet | power-upy, klíče a krystaly do 4 políček se ti samy přisunou |
| ☄️ Průrazný plamen | oheň tvých bomb proletí přes cihly a rozbije všechny v dosahu |
| 🦘 Přeskok bomb | chodíš přes bomby, nic tě nezastaví |

Po Wi-Fi se výprava hraje stejně: zakladatel v lobby přepne **REŽIM** na VÝPRAVA, zvolí obtížnost
a friendly fire a dá start (2–3 hráči). Po vítězství uvidí každý vítěznou obrazovku a místnost se vrátí do lobby.

## Hra po Wi-Fi

Jeden počítač dělá server, ostatní se připojí prohlížečem.

1. Na „serverovém“ počítači musí být nainstalovaný [Node.js](https://nodejs.org) (18+, stačí
   výchozí instalace). Soubory hry stáhnete na GitHubu přes **Code → Download ZIP** a rozbalíte.
2. Dvojklik na `start-wifi.command` (macOS) nebo `start-wifi.bat` (Windows). V terminálu
   funguje i `cd server && npm install && npm start`.
3. V terminálu se vypíše adresa, např. `http://192.168.0.94:8787`. Tu otevřou všichni hráči
   ve stejné Wi-Fi (i ten na serverovém počítači může použít `http://localhost:8787`).
4. V menu zvolte **Po Wi-Fi**, jeden založí hru a řekne ostatním čtyřpísmenný kód.
5. Zakladatel v lobby nastaví pravidla (množství power-upů, délka kola, počet vítězných kol,
   sudden death) a dá START. Ostatní nastavení vidí, měnit ho může jen zakladatel.

macOS i Windows se při prvním spuštění mohou zeptat, zda smí Node.js přijímat příchozí spojení
(Windows: „Brána firewall“, zaškrtněte soukromé sítě) – povolte, jinak se ostatní nepřipojí.

Kód serveru je v `server/` (Node.js + `ws`). Stránku hry servíruje sám, takže v lokální síti
nic dalšího není potřeba.

## Jak je to uvnitř

- `index.html` – celý klient: menu, lokální režimy (1 hráč, 2 hráči, kampaň), kreslení, síťový klient.
- `server/engine.js` – pravidla arény (pohyb, bomby, oheň, power-upy) bez DOM; načítá se v prohlížeči
  i v Node. Lokální aréna a kampaň v `index.html` mají tatáž pravidla napsaná znovu (záměrně, kvůli
  jednomu souboru bez závislostí) – při změně pravidel upravit obě místa.
- `coop.js` – Společná výprava: levely a témata, úkoly, příšery, bossové (`BOSS_TYPES`), oživování, zlaté schopnosti, statistiky. Jeden modul pro
  prohlížeč (lokální hra) i server (hra po Wi-Fi), takže se tato logika nepíše dvakrát.
