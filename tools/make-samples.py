#!/usr/bin/env python3
"""
Builds the sample transfer packets in public/samples.

Each packet is two pages, exactly as a real submission is: the account
transfer form the client signs, then the delivering firm's statement. The
workflow reads both and compares them, so the statement carries the identity
fields as well as the balance. A statement that only lists a firm, an account
number and a total gives the consistency check nothing to confirm the client
against, which is why every packet built without them comes back not in good
order however clean the form is.

Two things constrain what a sample packet can contain, both learned the hard
way from real runs rather than guessed at.

The contra firm fit check holds a firm to firm identifier map: the NANA code
on the form has to be the one the delivering firm actually uses. Sterling
Financial Partners requires 9921, confirmed by case 75834, which came back
with nothing wrong except a 4471 on the form. Learning another firm's code
is easy: run a packet naming it and the NIGO-09 message states the code it
expected.

The consistency check reads a third source neither page of the packet can
see: the firm's account master. A client who is not on it is flagged high
severity and the packet cannot pass, however well the form and the statement
agree with each other. Case 75855 proved this, failing on nothing but
"Margaret Ellison-Vandermeer was not found on the firm's account master".
Unlike the NANA message, this one does not name what it expected, so the
master's contents cannot be discovered by probing: they have to come from
whoever holds the workflow.

Yusuf Karim is the one client we know is on it, because case 75834 cleared
consistency for him and quoted his record's SSN, 418-90-2231. So every packet
here is Yusuf Karim at Sterling Financial Partners. Adding a second client
means being told one.

One packet is built to pass and two to fail, each for a different reason:

  packet-clean-ira.pdf        in good order
  packet-ira-incomplete.pdf   not in good order, completeness
  packet-mismatch.pdf         not in good order, consistency

Run:  python3 tools/make-samples.py
"""

import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

PAGE_W, PAGE_H = letter
MARGIN = 72.0
VALUE_X = 230.0
ROW = 20.0
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'samples')

SUBTITLE = 'Sample packet for testing the Account Transfer Validation console.'


def baseline(top, size):
    """pdfplumber reports a glyph's top; reportlab wants its baseline."""
    return PAGE_H - top - size * 0.718


def page(c, title, title_size, title_top, rows, first_row_top, subtitle=None, trailing=None):
    c.setFont('Helvetica-Bold', title_size)
    c.drawString(MARGIN, baseline(title_top, title_size), title)
    if subtitle:
        c.setFont('Helvetica', 8)
        c.drawString(MARGIN, baseline(88.7, 8), subtitle)

    c.setFont('Helvetica', 11)
    top = first_row_top
    for label, value in rows:
        c.drawString(MARGIN, baseline(top, 11), label)
        c.drawString(VALUE_X, baseline(top, 11), value)
        top += ROW

    # Free standing lines under the pairs: the election and the signatures.
    # A float in the list is a gap rather than a line.
    if trailing:
        top += 10.0
        for line in trailing:
            if isinstance(line, float):
                top += line
                continue
            c.drawString(MARGIN, baseline(top, 11), line)
            top += ROW


def build(name, form_rows, election, signature, signature_date, medallion, statement_rows):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=letter)

    page(
        c,
        'ACCOUNT TRANSFER FORM',
        15,
        68.1,
        form_rows,
        121.3,
        subtitle=SUBTITLE,
        trailing=[
            'Transfer election: ' + election,
            6.0,
            'Signature: ' + signature,
            'Signature date: ' + signature_date,
            'Medallion signature guarantee: ' + medallion
        ]
    )
    c.showPage()

    page(c, 'DELIVERING FIRM STATEMENT', 14, 68.9, statement_rows, 111.3)
    c.showPage()
    c.save()
    return path


# The delivering firm every packet is built around, and the identifier the
# contra firm fit check insists on for it.
FIRM = 'Sterling Financial Partners'
FIRM_NANA = '9921'
FIRM_FORM_ID = 'SFP-NA-200'


def form(client, dob, address, ssn, firm, account, registration, account_type, value, form_id):
    return [
        ('Client name:', client),
        ('Date of birth:', dob),
        ('Address:', address),
        ('SSN / TIN:', ssn),
        ('Contra firm:', firm),
        ('Contra account number:', account),
        ('NANA code:', FIRM_NANA),
        ('Registration:', registration),
        ('Account type:', account_type),
        ('Approximate value:', value),
        ('Form id:', form_id)
    ]


def statement(firm, holder, ssn, dob, registration, account, account_type, value):
    """The delivering firm's own record. It repeats the identity fields so the
       consistency check has two sides to compare rather than one."""
    return [
        ('Firm:', firm),
        ('Account holder:', holder),
        ('SSN / TIN on file:', ssn),
        ('Date of birth:', dob),
        ('Registration:', registration),
        ('Account number:', account),
        ('Account type:', account_type),
        ('Total value:', value)
    ]


FULL_IN_KIND = '[X] In kind [ ] Liquidate [X] Full [ ] Partial'
FULL_LIQUIDATE = '[ ] In kind [X] Liquidate [X] Full [ ] Partial'
NOTHING_TICKED = '[ ] In kind [ ] Liquidate [ ] Full [ ] Partial'


# --------------------------------------------------------------------------
# In good order. Signed, dated, guaranteed, an election with both a type and
# a scope, the statement agreeing with the form field for field, and the
# firm identifier the rulebook wants.
#
# The first of these is case 75834's packet with its one remaining fault
# corrected: that run was clean on consistency and completeness and failed
# only on the NANA code.
# --------------------------------------------------------------------------

build(
    'packet-clean-ira.pdf',
    form(
        client='Yusuf Karim',
        dob='11/04/1972',
        address='27 Maple Ct, Jersey City, NJ 07302',
        ssn='418-90-2231',
        firm=FIRM,
        account='4180920031',
        registration='Yusuf Karim',
        account_type='Traditional IRA',
        value='$95,000.00',
        form_id=FIRM_FORM_ID
    ),
    election=FULL_IN_KIND,
    signature='/s/ Yusuf Karim',
    signature_date='09/26/2026',
    medallion='AFFIXED',
    statement_rows=statement(
        firm=FIRM,
        holder='Yusuf Karim',
        ssn='418-90-2231',
        dob='11/04/1972',
        registration='Yusuf Karim',
        account='4180920031',
        account_type='Traditional IRA',
        value='$95,000.00'
    )
)

# --------------------------------------------------------------------------
# Not in good order, completeness. The form is unsigned, undated, no election
# is ticked, the Medallion guarantee is absent, and the SSN was never filled
# in. Everything else is right, including the firm identifier, so the only
# issues raised are the ones on the client's side of the packet.
# --------------------------------------------------------------------------

build(
    'packet-ira-incomplete.pdf',
    form(
        client='Yusuf Karim',
        dob='11/04/1972',
        address='27 Maple Ct, Jersey City, NJ 07302',
        ssn='(left blank)',
        firm=FIRM,
        account='4180920031',
        registration='Yusuf Karim',
        account_type='Traditional IRA',
        value='$95,000.00',
        form_id=FIRM_FORM_ID
    ),
    election=NOTHING_TICKED,
    signature='________________________',
    signature_date='____________',
    medallion='not affixed',
    statement_rows=statement(
        firm=FIRM,
        holder='Yusuf Karim',
        ssn='418-90-2231',
        dob='11/04/1972',
        registration='Yusuf Karim',
        account='4180920031',
        account_type='Traditional IRA',
        value='$95,000.00'
    )
)


# --------------------------------------------------------------------------
# Not in good order, consistency. The form is signed, dated and guaranteed,
# and it carries the right firm identifier, so nothing is missing and the
# contra firm fit is fine. It simply does not agree with the delivering firm
# on who the client is, which account this is, what kind of account it is, or
# what it holds. Four disagreements, each a different field.
# --------------------------------------------------------------------------

build(
    'packet-mismatch.pdf',
    form(
        client='Yusuf Karim',
        dob='11/04/1972',
        address='27 Maple Ct, Jersey City, NJ 07302',
        ssn='418-90-2231',
        firm=FIRM,
        account='4180920031',
        registration='Yusuf Karim',
        account_type='Traditional IRA',
        value='$95,000.00',
        form_id=FIRM_FORM_ID
    ),
    election=FULL_IN_KIND,
    signature='/s/ Yusuf Karim',
    signature_date='09/19/2026',
    medallion='AFFIXED',
    statement_rows=statement(
        firm=FIRM,
        holder='Yusuf A. Karim',            # not the name on the form
        ssn='418-90-2213',                  # two digits transposed
        dob='11/04/1972',
        registration='Yusuf A. Karim',
        account='4180920013',               # two digits transposed
        account_type='Roth IRA',            # the form says Traditional
        value='$88,240.00'                  # and the balance disagrees
    )
)

print('Wrote three packets to', OUT)
