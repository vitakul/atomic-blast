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

Hráči procházejí šest navazujících bludišť, každé s jinou grafikou a úkolem. Nesoupeří, spolupracují:

| Level | Prostředí | Úkol |
|---|---|---|
| 1 | Les | zničit všechny příšery |
| 2 | Jeskyně | najít 3 klíče schované pod cihlami |
| 3 | Ledová pevnost | stoupnout si **oba zároveň** na dva spínače v protilehlých koutech |
| 4 | Lávové doly | zničit hnízdo (3 zásahy ohněm), ze kterého se líhnou příšery, a pak dočistit mapu |
| 5 | Hrad | 2 klíče + zničit všechny příšery (včetně obrněnců na 3 zásahy) |
| 6 | Bossova komnata | porazit Velkého Bombuse |

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
  když tě vidí) a **obrněnec** (pomalý, 3 zásahy). Boss se pohybuje po mapě, boří cihly, volá pomocníky
  a při polovině životů zrychlí a začne střílet do čtyř stran. Zraňuje ho jen oheň z bomb.
- Příšery se schopnostmi přibývají s levely; v úvodu levelu se nové příšery představí s popisem:

  | Příšera | Od levelu | Co umí |
  |---|---|---|
  | Žabák | 1 Les | občas skočí o dvě políčka – přes cihlu, bombu i oheň; ve skoku ho oheň nechytí |
  | Sliz | 1 Les | po zásahu se rozdělí na dva malé, rychlejší slizy |
  | Krtek | 2 Jeskyně | zahrabe se (nezranitelný, leze pod cihlami) a vyleze poblíž hráče; chvíli bliká a ještě nezraňuje |
  | Pavouk | 2 Jeskyně | nechává pavučiny, ve kterých hráč jde pomalu; oheň je spálí, samy zmizí po chvíli |
  | Sněhulák | 3 Ledová pevnost | hází sněhové koule, které hráče na ~2 s zmrazí; spoluhráč ho rozmrazí dotykem (2 zásahy) |
  | Hltoun | 4 Lávové doly | jde po bombách a power-upech a polyká je; po třetí bombě praskne a vybuchne (zraní každého) |
  | Chameleon | 5 Hrad | střídavě se zneviditelní a v neviditelnosti se plíží k hráči |

  Hnízdo občas vylíhne i sliz, boss volá na pomoc i žabáky a slizy.
- Skóre je společné; power-upy se přenášejí do dalšího levelu (po smrti o jeden stupeň níž).
- Obtížnost (lehká · normální · těžká) mění rychlost a počet příšer a životy bosse.

Po Wi-Fi se výprava hraje stejně: zakladatel v lobby přepne **REŽIM** na VÝPRAVA, zvolí obtížnost
a friendly fire a dá start (2–3 hráči). Po vítězství nebo konci výpravy se místnost vrátí do lobby.

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
- `coop.js` – Společná výprava: levely a témata, úkoly, příšery, boss, oživování. Jeden modul pro
  prohlížeč (lokální hra) i server (hra po Wi-Fi), takže se tato logika nepíše dvakrát.
