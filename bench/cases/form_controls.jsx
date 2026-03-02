<Form>
  <Input
    value={email}
    placeholder="you@acme.co"
    onInput={(event) => onEmail(event.target.value)}
  />
  <Switch checked={notifications} onCheckedChange={(event) => onNotifications(event)} />
  <Button disabled={email.trim().length === 0} onClick={() => submit()}>
    Save settings
  </Button>
</Form>
