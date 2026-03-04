from picoclaw_client import PicoclawClient


def main() -> None:
    client = PicoclawClient()

    goals = client.read_file('memory/MEMORY.md')
    print('📝 Your goals:')
    print(goals)

    plan = """
# My Debt Payoff Plan
- Total: $45,000
- Target: Self-employed in 12 months
- Action: Build side income + pay down debt
""".strip()

    client.write_file('debt_plan.md', plan + '\n')
    print('✅ Created debt_plan.md')

    today = client.exec('date')
    print(f'📅 Today: {today}')


if __name__ == '__main__':
    main()
