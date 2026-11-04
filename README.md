# Atomic Blast

Rodinná hra na motivy Bombermana, běží v prohlížeči. Jeden soubor `index.html`, bez závislostí.

**Hrát online (bez instalace):** https://vitakul.github.io/atomic-blast/

## Režimy

| Režim | Ovládání |
|---|---|
| 1 hráč proti počítači | WASD + mezerník |
| 2 hráči u jedné klávesnice | hráč 1: WASD + mezerník · hráč 2: šipky + Enter |
| Kampaň (příšery, klíč, portál, 3 životy) | WASD + mezerník |
| Po Wi-Fi, až 3 hráči, každý u svého počítače | šipky nebo WASD (každý si vybere), mezerník = bomba |

Esc kdykoli vrátí do menu.

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
