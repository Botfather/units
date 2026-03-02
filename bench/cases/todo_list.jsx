<App>
  <Header title="Tasks" />
  <InputRow
    value={draft}
    placeholder="Add a task"
    onInput={(event) => onDraft(event)}
    onSubmit={() => addTask()}
  />
  {items.length === 0 ? <p>No todos yet.</p> : null}
  <List>
    {items.map((item) => (
      <TaskRow
        key={item.id}
        item={item}
        onToggle={() => toggleTask(item.id)}
        onRemove={() => removeTask(item.id)}
      />
    ))}
  </List>
</App>
