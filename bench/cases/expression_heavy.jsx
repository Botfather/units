<Grid
  columns={layout.columns ?? 3}
  gap={layout.gap ?? 12}
  dense={filters.enabled && filters.mode !== "none"}
>
  {cards.map((card, index) => (
    <Card
      key={card.id}
      className={index % 2 === 0 ? "featured" : "compact"}
      score={metrics?.[card.id]?.score ?? 0}
      visible={permissions?.[card.id] !== false}
    >
      <span>{`${card.title} - ${metrics?.[card.id]?.score ?? 0}`}</span>
      <Button onClick={() => openCard(card.id, routes?.detail ?? "/detail")}>Open</Button>
    </Card>
  ))}
</Grid>
