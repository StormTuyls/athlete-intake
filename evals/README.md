# Evalharnas

Zonder deze map is "kwaliteitsborging via testset" een intentie in plaats van een deliverable.

## Structuur

```
fixtures/
  synthetic/   in git. Zelfgemaakte documenten, veilig te delen.
  real/        NIET in git. Geanonimiseerde klantdocumenten.
expected/      verwachte veldwaarden per fixture, als JSON.
```

`fixtures/real/` staat in `.gitignore`. Echte medische documenten horen niet in een repository,
ook niet geanonimiseerd. Ze leven lokaal bij de ontwikkelaar en in de beveiligde opslag van de klant.

## Draaien

```bash
npm run eval
```

## Wat er getest wordt

Niet alleen of de velden gevonden worden, ook het tegendeel:

1. Een document zonder relevante inhoud mag geen velden opleveren. Geen enkel veld verzinnen.
2. Twee documenten met een tegenstrijdige geboortedatum moeten `conflicting` opleveren, niet
   stilzwijgend één waarde kiezen.
3. Een citaat dat niet in de brontekst terug te vinden is moet op `medium` uitkomen, niet op `high`.
