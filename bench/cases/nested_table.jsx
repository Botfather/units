<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Team</TableHead>
      <TableHead>Member</TableHead>
      <TableHead>Role</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {teams.map((team) => (
      <React.Fragment key={team.id}>
        {team.members.map((member) => (
          <TableRow key={member.id}>
            <TableCell>{team.name}</TableCell>
            <TableCell>{member.name}</TableCell>
            <TableCell>{member.role}</TableCell>
          </TableRow>
        ))}
      </React.Fragment>
    ))}
  </TableBody>
</Table>
