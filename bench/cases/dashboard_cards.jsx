<Dashboard>
  <TopBar title="Revenue" />
  <Grid>
    {cards.map((card) => (
      <StatCard
        key={card.id}
        title={card.title}
        value={card.value}
        trend={card.trend}
      />
    ))}
  </Grid>
  {alerts.length > 0 ? (
    <AlertList>
      {alerts.map((alert) => (
        <Alert key={alert.id} tone={alert.tone}>
          {alert.message}
        </Alert>
      ))}
    </AlertList>
  ) : null}
</Dashboard>
