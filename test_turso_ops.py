import httpx

url = 'https://kariarpay-prakhardhakad.aws-ap-south-1.turso.io/v2/pipeline'
token = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODk0NjI4NjEsImlkIjoiMDFhMGE0NGItYzMwMS03NDNjLWE5ODQtNDg1NjY3MmFkOWRjIiwia2lkIjoiR2dnbms3LWJpc1dTaFpkY29qNVZQdUtPUlBiOER3Nl9XNWs3UmlYVUEycyIsInJpZCI6IjY4NzdkYjVjLWNhNzgtNGU0NS05NTNhLTVjMTVhNzkxYjNlNyJ9.66ztZTeIGHcW7RO-T2Eli2IPF_lFJhaCpaJwX1ML_cgltnH7zwQaPaacHl0arLFfZWBZ7UT2h-jEy4NzHRSMCQ'
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

req = {
    'requests': [
        {
            'type': 'execute',
            'stmt': {
                'sql': 'INSERT INTO businesses (id, name, owner_name, owner_phone, settlement_cycle, salary_divisor, overtime_policy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                'args': [
                    {'type': 'text', 'value': 'BIZ-TEST'},
                    {'type': 'text', 'value': 'Test Workshop'},
                    {'type': 'text', 'value': 'Prakhar'},
                    {'type': 'text', 'value': '9999999999'},
                    {'type': 'text', 'value': 'weekly'},
                    {'type': 'integer', 'value': '26'},
                    {'type': 'text', 'value': '{"kind": "hourly", "rate_paise": 5000}'},
                    {'type': 'text', 'value': '2026-09-15T14:40:00Z'}
                ]
            }
        },
        {
            'type': 'execute',
            'stmt': {
                'sql': 'SELECT * FROM businesses WHERE id = ?',
                'args': [{'type': 'text', 'value': 'BIZ-TEST'}]
            }
        },
        {
            'type': 'execute',
            'stmt': {
                'sql': 'DELETE FROM businesses WHERE id = ?',
                'args': [{'type': 'text', 'value': 'BIZ-TEST'}]
            }
        }
    ]
}

res = httpx.post(url, headers=headers, json=req, timeout=10)
print('Status:', res.status_code)
for r in res.json().get('results', []):
    print(r)
